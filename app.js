const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

const https = require('https');
const moment = require('moment');
const Promise = require('bluebird');
const rp = require('request-promise');

const services = AWS.Service._serviceMap;
const serviceMap = [];
for (var service in AWS.Service._serviceMap) {
  serviceMap.push(service);
}

//Set up Claudia API.
var ApiBuilder = require('claudia-api-builder');
var api = new ApiBuilder();
module.exports = api;

//The step in the oAuth flow where the user is sent to this endpoint, with a code in the querystring, and we take that code and exchange it for an access_token with the Slack API.
api.get('/slack/oauth', function(req) {

  return rp.get('https://slack.com/api/oauth.access?client_id=' + req.env.slackClientId + '&client_secret=' + req.env.slackClientSecret + '&code=' + req.queryString.code)
    .then( function(response){ //The Slack Call returns 200 even if it failed. So check for that.
      response = JSON.parse(response);
      if( response.ok ){
        return response;
      }
      else{
        throw 'Slack responded with an error: '+response.error;
      }
    })
    .then( function (response) {
      //Save token to DB
      var saveToDb = {
        TableName: "RepoInfoSlackKeys",
        Item: response
      };
      console.log("Saving:" + JSON.stringify(saveToDb));

      //http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#put-property
      const DBDocClient = Promise.promisifyAll(new AWS.DynamoDB.DocumentClient());
      return DBDocClient.putAsync(saveToDb);
    })
    .then( function (dbResponse) {
      console.log("Success saving to DB.");
      return "Saved to DB."
    })
    .catch( function(err){
      console.log("Caught Error during oAuth flow: " + err);
      throw "Error GETting Slack URL or saving to DynamoDB: "+err;
    });
},
{
  success: {
    code: 301,
    headers: {
      Location: "http://gitrepo.info/added.html"
    }
  }
});

api.post('/slack/newMessage', function(req){

  var postBody = req.body;
  if( postBody.token != req.env.slackVerificationToken ){
    return "Token did not match the verification token for this app. Did someone other than Slack send this request?";
  }

  if( postBody['type'] == "url_verification"){
    return postBody['challenge'];
  }

  if( postBody.event.text.includes('github.com/') ) {
    console.log("Calling sub-lambda function to process in the background.");
    //Reply to Slack immediately. We will continue to process in the background.
    var invokeOptions = {
      FunctionName: req.lambdaContext.functionName, //call this lambda function
      Qualifier: req.lambdaContext.functionVersion,
      InvocationType: 'Event',
      Payload: JSON.stringify({ doLongTask: true, originalReq: req})
    };
    console.log(JSON.stringify(invokeOptions));

    return new Promise( //Must return a promise so that THIS function does not get cancelled before lambda.invoke finishes.
      (resolve, reject) => {
        lambda.invoke(
          invokeOptions,
          (err, done) => {
            if (err) return reject(err);
            resolve(done);
          }
        );
      })
      .then((invoked) => {
        console.log('Sub-lambda invoked successfully')
        return invoked;
      })
      .catch((ex) => {
        console.error('Could not invoke sub-lambda.')
        console.error(ex);
        return 'Error invoking sub-lambda...\n ${ex.message}';
      });
  }

});

//api.intercept is called before other routes, so if a call came in but has doLongTask set, then do the long-running-task
//and don't pass on to the regular handler.
api.intercept(function(event){
  console.log(JSON.stringify(event));
  //If it's a regular call, from APIGateway, continue as usual.
  if( !event.doLongTask ){
    console.log('Regular call: Continuing as normal.');
    return event;
  }
  else {
    console.log('doLongTask is set. Starting process...');
    return getInfoAndMakeSlackPost(event)
    .then(() => false); // prevents normal execution
  }
});

function getInfoAndMakeSlackPost(event){
    var req = event.originalReq;
    var postBody = req.body;

    //Extract the linked repo's path.
    var directoryParts = postBody.event.text.match(/github\.com\/([A-Za-z0-9_\.-]*)\/([A-Za-z0-9_\.-]*)/);
    var repoOwner = directoryParts[1];
    var repoName = directoryParts[2];

    //Make call to get details about repo.
    //console.log("https://libraries.io/api/github/"+repoOwner+"/"+repoName+"/dependencies?api_key="+req.env.librariesApiKey);
    //https.get("https://libraries.io/api/github/"+repoOwner+"/"+repoName+"/dependencies?api_key="+req.env.librariesApiKey, function(librariesIoResponse){
    var message, messageFallback, repoFullName;
    return rp.get({
      url: "https://api.github.com/repos/"+repoOwner+"/"+repoName+"?client_id="+req.env.githubClientId+"&client_secret="+req.env.githubClientSecret,
      headers: {'user-agent': 'RepoInfo/0.0.1'}
    })
    .then( function(githubApiResponse) {

      //console.log(githubApiResponse);
      var githubApiData = JSON.parse(githubApiResponse);
      //console.log('Received from github: ' + githubApiData);
      repoFullName = githubApiData.full_name;

      message = //">>> *"+repoFullName+"*: \n" +
        githubApiData.stargazers_count + ":star:   " +
        githubApiData.subscribers_count + " :eye:   " +
        githubApiData.forks_count + " :fork_and_knife: " +
        "Created: " + moment(githubApiData.created_at).fromNow() + ", " +
        "Last push: " + moment(githubApiData.pushed_at).fromNow();

      //Fallback message without emojis for readers that can't display formatting (eg. IRC).
      messageFallback = repoFullName + " has " +
        githubApiData.stargazers_count + " stars, " +
        githubApiData.subscribers_count + " watchers " +
        "and " + githubApiData.forks_count + " forks. " +
        "It was created " + moment(githubApiData.created_at).fromNow() +
        " and last pushed to " + moment(githubApiData.pushed_at).fromNow();

      return rp.get("https://libraries.io/api/github/"+repoOwner+"/"+repoName+"/dependencies?api_key="+req.env.librariesApiKey);
    })
    .then(function(librariesIoResponse){
      var librariesIoResponseData = JSON.parse(librariesIoResponse);
      var deprecatedDependencies = librariesIoResponseData.dependencies.filter((d) => d.deprecated);
      var outdatedDependencies = librariesIoResponseData.dependencies.filter((d) => d.outdated);
      message += "\n License: "+librariesIoResponseData.license+", \n" +
        librariesIoResponseData.dependencies.length+" dependencies";
      if( deprecatedDependencies.length > 0 && outdatedDependencies.length > 0 ) {
        if (deprecatedDependencies.length > 0) {
          message += ", " + deprecatedDependencies.length + " deprecated"
          if (deprecatedDependencies.length <= 3) {
            message += ": " + deprecatedDependencies.map((d) => d.name).join(",") + ".\n";
          }
        }
        if (outdatedDependencies.length > 0) {
          message += ", " + outdatedDependencies.length + " outdated"
          if (outdatedDependencies.length <= 3) {
            message += ": " + outdatedDependencies.map((d) => d.name).join(",") + ".\n";
          }
        }
      }
      else{
        message += ", all up to date";
      }


    })
    .catch( function librariesIoFailed(err){
      //Do nothing particularly.
      console.error("Failed call to Libraries.io: "+err.message);
      console.error(JSON.stringify(err));
    })
    .then(function(){
      console.log('Getting tokens from DynamoDB...');

      //Grab all bot_user_tokens for this team (generated and stored in DynamoDB when the bot was added to this team).
      //There may be more than 1 if multiple users have authorized the bot.
      const DBDocClient = Promise.promisifyAll(new AWS.DynamoDB.DocumentClient());

      return DBDocClient.queryAsync({
        TableName: 'RepoInfoSlackKeys',
        KeyConditionExpression: 'team_id = :team_id',
        ExpressionAttributeValues: {
          ':team_id': postBody.team_id
        }
      })
    })
    .then( function(dynamoDbResponse){
      //Use Slack's Web-API to post a message.
      var postFormData =
        "token=" + encodeURIComponent(dynamoDbResponse.Items[0].bot.bot_access_token) +
        "&channel=" + encodeURIComponent(postBody.event.channel) +
          //"&text=" + encodeURIComponent(message) +
        "&attachments="+JSON.stringify([
          {
            "fallback": messageFallback,
            "title": repoFullName,
            "title_link": "https://github.com/" + repoOwner + "/" + repoName,
            "text": message,
            // "image_url": "http://ichef-1.bbci.co.uk/news/660/cpsprodpb/978E/production/_90989783_doctorsstrike.jpg"
          }
        ]);
      console.log('Posting message:');
      console.log(postFormData);
      //var postMessageUrl = 'https://slack.com/api/chat.postMessage?token='++'&channel='++'&text='+encodeURIComponent(message)+"&attachments="+encodeURIComponent(attachments);
      return rp.post('https://slack.com/api/chat.postMessage', {form:postFormData});
    })
    .then( function(postMessageResponse){
      postMessageResponse = JSON.parse(postMessageResponse);
      if( postMessageResponse.ok ) {
        console.log('Successfully sent message to Slack channel.');
        console.log(postMessageResponse);
        return "OK";
      }
      else{
        throw postMessageResponse.error;
      }
    })
    .catch( function(err){
      console.error(err);
      throw "Error: "+err;
    });
}