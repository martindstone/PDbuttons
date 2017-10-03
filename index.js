// index.js

var express = require('express');
var app = express();
var async = require('async');
var bodyParser = require('body-parser');

const util = require('util');

var token;

var request = require('request');
var pdRequest = request.defaults({
	headers: { 
		"Content-type": "application/json",
		"Accept": "application/vnd.pagerduty+json;version=2",
		"Authorization": "Token token=" + token
	}
});

var message_type_strings = {
	'incident.trigger': 'triggered',
	'incident.acknowledge': 'acknowledged',
	'incident.escalate': 'escalated',
	'incident.resolve': 'resolved',
	'incident.unacknowledge': 'unacknowledged',
	'incident.assign': 'reassigned',
	'incident.delegate': 'delegated'
};

var AWS = require('aws-sdk');


app.set('port', (process.env.PORT || 5000));

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.text());
app.use(bodyParser.json());

function getTriggerLE(token, triggerURL, callback) {
	var options = {
		headers: { 
			"Content-type": "application/json",
			"Accept": "application/vnd.pagerduty+json;version=2",
			"Authorization": "Token token=" + token
		},
		uri: triggerURL,
		method: "GET",
		qs: {
			"include[]": "channels"
		}
	}
	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error getting trigger log entry: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		} else {
			var trigger = JSON.parse(body);
			callback(trigger);
		}
	});
}

function getEP(epID, buttonPusherID, incidentID, incidentTitle) {
	var options = {
		headers: { 
			"Content-type": "application/json",
			"Accept": "application/vnd.pagerduty+json;version=2",
			"Authorization": "Token token=" + token
		},
		uri: "https://api.pagerduty.com/escalation_policies/" + epID,
		method: "GET",
		qs: {
			"include[]": "targets"
		}
	}

	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error getting EP: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		} else {
			var ep = JSON.parse(body);
			var targets = [];
			ep.escalation_policy.escalation_rules.forEach(function(rule) {
				console.log("Rule " + rule.id);
				rule.targets.forEach(function(target) {
					console.log("Target " + target.id);
					if ( target.type == "user" ) {
						console.log("User " + target.id);
						if ( targets.indexOf(target.id) == -1 ) {
							targets.push(target.id);
						}
					} else if ( target.type == "schedule" ) {
						console.log("Schedule " + target.id);
						target.users.forEach(function(user) {
							console.log("User " + user.id + "(" + user.summary + ")");
							if ( targets.indexOf(user.id) == -1 ) {
								targets.push(user.id);
							}
						});
					}
				});
			});
			console.log(JSON.stringify(targets, null, 4));

			for (var i = 0; i < targets.length; i++ ) {
				var userID = targets[i];
				targets[i] = {
					responder_request_target: {
						id: userID,
						type: "user_reference"
					}
				}
			}
			var message = "Please help with incident " + incidentTitle;
			
			while ( targets.length > 0 ) {
				addResponders(message, targets.splice(0,1), incidentID, buttonPusherID);
			}
		}
	});
}

function addNote(token, incidentURL, fromEmail, note){
	var body = {
		"note": {
			"content": note
		}
	};
	var options = {
		headers: { 
			"Content-type": "application/json",
			"Accept": "application/vnd.pagerduty+json;version=2",
			"Authorization": "Token token=" + token,
			"From": fromEmail
		},
		uri: incidentURL + "/notes",
		method: "POST",
		json: body
	};
	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error adding note: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		}
	});
}

function addResponders(message, targets, incidentID, buttonPusherID) {

	var body = {
		"message": message,
		"responder_request_targets": targets,
		"requester_id": buttonPusherID
	};

	var options = {
		headers: { 
			"Content-type": "application/json",
			"Accept": "application/vnd.pagerduty+json;version=2",
			"Authorization": "Token token=" + token
		},
		uri: "https://api.pagerduty.com/incidents/" + incidentID + "/responder_requests",
		method: "POST",
		json: body
	};
	
	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error adding responders: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		} else {
			console.log("Added " + targets.length + " responders to incident " + incidentID);
		}
	});	
}


function PDRequest(token, endpoint, method, options, callback) {

	var merged = Object.assign({}, {
		method: method,
		dataType: "json",
		url: "https://api.pagerduty.com/" + endpoint,
		headers: {
			"Authorization": "Token token=" + token,
			"Accept": "application/vnd.pagerduty+json;version=2"
		}
	},
	options);

	request(merged, function(err, res, body) {
		var data;
		try {
			data = JSON.parse(body);
		} catch (e) {
		}
		callback(err, data);
	});
}


function fetch(token, endpoint, params, callback, progressCallback) {
	var limit = 100;
	var infoFns = [];
	var fetchedData = [];

	var commonParams = {
			total: true,
			limit: limit
	};

	var getParams = Object.assign({}, commonParams, params);

	var options = {
		qs: getParams
	};

	PDRequest(token, endpoint, "GET", options, function(err, data) {
		var total = data.total;
		Array.prototype.push.apply(fetchedData, data[endpoint]);

		if ( data.more == true ) {
			var indexes = [];
			for ( i = limit; i < total; i += limit ) {
				indexes.push(Number(i));
			}
			indexes.forEach(function(i) {
				var offset = i;
				console.log(`offset: ${offset}`);
				infoFns.push(function(callback) {
					var options = {
						qs: Object.assign(getParams, { offset: offset })
					}
					PDRequest(token, endpoint, "GET", options, function(err, data) {
						Array.prototype.push.apply(fetchedData, data[endpoint]);
						if (progressCallback) {
							progressCallback(data.total, fetchedData.length);
						}
						callback(null, data);
					});
				});
			});

			async.parallel(infoFns, function(err, results) {
				callback(fetchedData);
			});
		} else {
			callback(fetchedData);
		}
	});
}

function fetchServices(token, callback) {
	fetch(token, "services", null, callback);
}

function fetchUsers(token, callback) {
	fetch(token, "users", null, callback);
}

app.post('/allhands', function (req, res) {
	token = req.query.token;
	var requesterID;
	
	req.body.messages.forEach(function(message) {

		try {
			if ( message.log_entries[0].agent.type == 'user_reference' ) {
				requesterID = message.log_entries[0].agent.id;				
			}
		}
		catch (e) {
		}
		
		if ( ! requesterID ) { 
			requesterID = req.query.requester_id;
		}

		if ( message.event == "incident.custom" || message.event == "incident.trigger" ) {
			getEP(message.incident.escalation_policy.id, requesterID, message.incident.id, message.incident.title);	
		}
	});
	res.end();
});

app.post('/awsconsole', function (req, res) {
	
	try {
		var incidentTitle = req.body.messages[0].incident.title;
		var incidentURL = req.body.messages[0].incident.self;
		
		getTriggerLE(req.query.token, req.body.messages[0].incident.first_trigger_log_entry.self, function(logEntry) {
			console.log("got log entry: %j", logEntry);
			var region = logEntry.log_entry.channel.cef_details.source_location;
			var instanceID = logEntry.log_entry.channel.cef_details.source_component;
			var creds = new AWS.Credentials({
				accessKeyId: req.query.awsAccess,
				secretAccessKey: req.query.awsSecret
			});
			
			var ec2 = new AWS.EC2({
				region: region,
				credentials: creds
			});
		
			var params = {
				InstanceId: instanceID
			};
			ec2.getConsoleOutput(params, function(err, data) {
				if (err) {
					console.log(err, err.stack);
				} else {
					var buf = Buffer.from(data.Output, 'base64');
					var output = buf.toString('ascii');
					var lines = output.split('\n');
					var tail = lines.slice(-10);
					var note = tail.join('\n');
					note = note.replace(/(.{80})/g, "$1\n");
					addNote(req.query.token, incidentURL, req.query.fromEmail, note);
				}
			});
		});
	}
	catch (e) {
		console.log(e.message);
	}
	finally {
		res.end();
	}
});

app.post('/awsreboot', function(req, res) {
	try {
		var incidentURL = req.body.messages[0].incident.self;
	
		getTriggerLE(req.query.token, req.body.messages[0].incident.first_trigger_log_entry.self, function(logEntry) {
			var region = logEntry.log_entry.channel.cef_details.source_location;
			var instanceID = logEntry.log_entry.channel.cef_details.source_component;
			var creds = new AWS.Credentials({
				accessKeyId: req.query.awsAccess,
				secretAccessKey: req.query.awsSecret
			});

			var ec2 = new AWS.EC2({
				region: region,
				credentials: creds
			});
		
			var params = {
				InstanceIds: [ instanceID ]
			};
			ec2.rebootInstances(params, function(err, data) {
				if (err) {
					console.log(err, err.stack);
				} else {
					var note = "Reboot requested for instance " + instanceID;
					addNote(req.query.token, incidentURL, req.query.fromEmail, note);
				}
			});
		});
	}
	catch (e) {
		console.log(e.message);
	}
	finally {
		res.end();
	}
});

function sendSlackResponse(responseURL, response, in_channel) {
	
	if ( typeof response == "string" ) {
		response = {
			response_type: in_channel ? "in_channel" : "ephemeral",
			text: response
		};
	}

	var options = {
		headers: {
			"Content-type": "application/json"
		},
		uri: responseURL,
		method: "POST",
		json: response
	};
	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error sending response to " + responseURL + ": " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		} else {
			console.log(`Sent a Slack response to ${responseURL}`);
		}
	});
}

app.post('/slackuser', function(req, res) {
	var token = req.query.token;
	var fromEmail = req.query.from;
	var service = req.query.service;

	console.log(`Got Slack command from ${req.body.user_name}: ${req.body.command} ${req.body.text}`);
	console.log(`From ${fromEmail}`);
	
	if ( ! token || ! fromEmail || ! service ) {
		res.end("This command is not configured correctly. Please contact your PagerDuty administrator.");
	}

	var text = req.body.text;
	var re = /(.+?):\s+(.+)/;
	var split = re.exec(text);
	
	fromEmail = fromEmail.replace(' ', '+');

	if ( ! split || split.length < 3 ) {
		res.end(`Usage: ${req.body.command} <pd_service_name>: incident title`);
		return;
	}
	
	var user_name = split[1];
	var title = split[2];
	
	var escaped = /<.+\|(.+)>/.exec(user_name);
	if ( escaped && escaped.length == 2 ) {
		user_name = escaped[1];
	}

	res.end(`Triggering an incident titled "${title}" for user ${user_name}...`);
	req.body.text = title;
	
	var responseURL = req.body.response_url;
	
	fetchUsers(token, function(users) {
		console.log(`got ${users.length} users`);
		var user;
		
		users.forEach(function(u) {
			console.log(u.email.toLowerCase() + " == " + user_name.toLowerCase());
			if ( u.summary.toLowerCase() == user_name.toLowerCase() || u.email.toLowerCase() == user_name.toLowerCase() ) {
				user = u;
			}
		});
		
		if ( ! user ) {
			sendSlackResponse(responseURL, `Couldn't find a user named "${user_name}"`)
			return;
		}
		
		var incident = {
			incident: {
				type: "incident",
				title: title,
				service: {
					id: service,
					type: "service_reference"
				},
				assignments: [
					{
						assignee: {
							id: user.id,
							type: "user_reference"
						}
					}
				]
			}
		};
		var options = {
			headers: { 
				"Content-type": "application/json",
				"Accept": "application/vnd.pagerduty+json;version=2",
				"Authorization": "Token token=" + token,
				"From": fromEmail
			},
			uri: "https://api.pagerduty.com/incidents",
			method: "POST",
			json: incident
		};
		
		request(options, function(error, response, body) {
			if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
				console.log("Error creating incident: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
			} else {
				var response = { 
					response_type: "ephemeral", 
					text: `Successfully triggered an incident titled "${req.body.text}" for user ${user.summary}.`, 
					attachments: [ 
						{ 
							title: body.incident.summary, 
							title_link: body.incident.html_url 
						} 
					] 
				}
				sendSlackResponse(responseURL, response);			}
		});	
	});
});


app.post('/slack', function (req, res) {
	var token = req.query.token;

	console.log(`Got Slack command from ${req.body.user_name}: ${req.body.command} ${req.body.text}`);
	
	var text = req.body.text;
	var re = /(.+?):\s+(.+)/;
	var split = re.exec(text);
	
	if ( ! split || split.length < 3 ) {
		res.end(`Usage: ${req.body.command} <pd_service_name>: incident title`);
		return;
	}
	
	var service_name = split[1];
	var title = split[2];
	
	res.end(`Triggering an incident titled "${title}" on service ${service_name}...`);
	req.body.text = title;
	
	var responseURL = req.body.response_url;

	var service;

	fetchServices(token, function(services) {
		services.forEach(function(s) {
			if ( s.summary.toLowerCase() == service_name.toLowerCase() ) {
				service = s;
			}
		});
		if ( ! service ) {
			sendSlackResponse(responseURL, `Couldn't find a service named "${service_name}"`);
			return;
		}

		PDRequest(token, "services/" + service.id + "?include[]=integrations", "GET", null, function(err, data) {
			if (err) {
				console.log(util.inspect(err, false, null));
				sendSlackResponse(responseURL, `Oops, couldn't get service info for "${service.summary}" (${service.html_url})`);
				return;
			} else {
				var integration;
				data.service.integrations.forEach(function(i) {
					if ( i.vendor && i.vendor.summary && i.vendor.summary.toLowerCase().indexOf("slack to pagerduty") > -1 ) {
						console.log(i.integration_key + " is a slack integration");
						integration = i;
					}
				});
				
				if ( ! integration ) {
					var response = {
						response_type: "ephemeral",
						text: `Service "${service.summary}" (${service.html_url}) was found but does not have a Slack integration. Please click on the link below and add a "Slack to PagerDuty" integration by clicking on the green "New Integration" button.`,
						attachments: [
							{
								title: service.summary,
								title_link: service.html_url + "/integrations"
							}
						]
					};
					sendSlackResponse(responseURL, response);
					return;
				}
				
				var url = `https://events.pagerduty.com/integration/${integration.integration_key}/enqueue`;
			
				var options = {
					headers: { 
						"Content-type": "application/json",
						"Accept": "application/vnd.pagerduty+json;version=2"
					},
					uri: url,
					method: "POST",
					json: req.body
				};
				request(options, function(error, response, body) {
					if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
						console.log("Error triggering incident: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
						sendSlackResponse(responseURL, "Couldn't trigger the incident! Please try again or contact your PagerDuty support team.");
					} else {
						console.log(`Sent an event to ${service.summary}`);
						var response = { 
							response_type: "ephemeral", 
							text: `Successfully triggered an incident titled "${req.body.text}" on service ${service.summary}.`, 
							attachments: [ 
								{ 
									title: "View the incident in PagerDuty", 
									title_link: service.html_url 
								} 
							] 
						}
						sendSlackResponse(responseURL, response);
					}
				});
			}
		});
	});
});


app.post('/whatsapp', function(req, res) {
	var instance_id = req.query.instance_id;
	var client_id = decodeURIComponent(req.query.client_id);
	var client_secret = req.query.client_secret;
	var group_admin = req.query.group_admin;
	var group_name = decodeURIComponent(req.query.group_name);
	var url = 'http://api.whatsmate.net/v2/whatsapp/group/message/' + instance_id;
	
	var headers = {
		'Content-Type': 'application/json',
		'X-WM-CLIENT-ID': client_id,
		'X-WM-CLIENT-SECRET': client_secret
	};
	
	var message = req.body.messages[0];
	var wa_message_summary = message.incident.summary.replace(/\\n/g, '\n');

	var wa_message = '*Incident Title:* ' + wa_message_summary + '\n*Event:* ' + message_type_strings[message.event] + '\n*By:* ' + message.incident.last_status_change_by.summary + '\n*Service:* '  + message.incident.service.name + '\n*URL:* ' + message.incident.html_url;
	
	var body = {
		'group_admin': group_admin,
		'group_name': group_name,
		'message': wa_message
	};
	
	var options = {
		headers: headers,
		uri: url,
		method: 'POST',
		json: body
	};
	
	request(options, function(error, response, body) {
		if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
			console.log("Error sending WA message: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
		} else {
			console.log("Sent WA message: " + JSON.stringify(response, null, 2));
		}
	});
	
	res.end();
});


app.post('/pingdom', bodyParser.json(), function(req, res) {

	var action = req.query.action;
	var incident = req.body.messages[0].incident;
	var token = req.query.token;
	var user = req.query.user;
	var pingdom_user = req.query.pingdom_user;
	var pingdom_pass = req.query.pingdom_pass;
	var pingdom_token = req.query.pingdom_token;
	var event = req.body.messages[0].event;

	getTriggerLE(token, incident.first_trigger_log_entry.self, function(logEntry) {
		console.log("event type: " + event );
		var pingdom_args, note;
		if ( action == "pause" || event == 'incident.acknowledge' ) {
			console.log("pause the check");
			pingdom_args = "paused=true";
			agent = req.body.messages[0].log_entries[0].agent.summary ? req.body.messages[0].log_entries[0].agent.summary : "unknown";
			note = "Paused pingdom check " + logEntry.log_entry.channel.incident_key + " because the incident was acknowledged by " + agent + ". Will unpause when the incident is resolved.";
		} else if ( action == "unpause" || event == 'incident.resolve' ) {
			console.log("unpause the check");
			pingdom_args = "paused=false";
			agent = req.body.messages[0].log_entries[0].agent.summary ? req.body.messages[0].log_entries[0].agent.summary : "unknown";
			note = "Unpaused pingdom check " + logEntry.log_entry.channel.incident_key + " because the incident was resolved by " + agent + ".";
		} else {
			res.end();
			return;
		}

		var options = {
			auth: {
				user: pingdom_user,
				pass: pingdom_pass
			},
			headers: { 
				"App-Key": pingdom_token
			},
			uri: "https://api.pingdom.com/api/2.0/checks/" + logEntry.log_entry.channel.incident_key + "?" + pingdom_args,
			method: "PUT"
		};
		
		request(options, function(error, response, body) {
			if ( ! response.statusCode || response.statusCode < 200 || response.statusCode > 299 ) {
				console.log("Error requesting from pingdom: " + error + "\nResponse: " + JSON.stringify(response, null, 2) + "\nBody: " + JSON.stringify(body, null, 2));
			} else {
				if ( user ) {
					addNote(token, incident.self, user, note);
				}
			}
		});	
	});

	res.end();
});



app.listen(app.get('port'), function() {
	console.log('PDbutton listening on port', app.get('port'));
});
