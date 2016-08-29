const AWS = require('aws-sdk');

const https = require('https');
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
      Location: "http://google.com"
    }
  }
});

api.post('/slack/newMessage', function(req){
  //console.log(JSON.stringify(req));

  var postBody = req.body;
  if( postBody.token != req.env.slackVerificationToken ){
    return "Token did not match the verification token for this app. Did someone other than Slack send this request?";
  }

  if( postBody['type'] == "url_verification"){
    return postBody['challenge'];
  }

  if( postBody.event.text.includes('github.com/') ){
    //TODO: Reply to Slack immediately. We will continue to process in the background.
    // Think you need to use the req.lambdaContext object, and return a Promise that never gets resolved.

    //Extract the linked repo's path.
    var directoryParts = postBody.event.text.match(/github\.com\/([A-Za-z0-9_\.-]*)\/([A-Za-z0-9_\.-]*)/);
    console.log(directoryParts);
    var repoOwner = directoryParts[1];
    var repoName = directoryParts[2];


    //Make call to get details about repo.
    //console.log("https://libraries.io/api/github/"+repoOwner+"/"+repoName+"/dependencies?api_key="+req.env.librariesApiKey);
    //https.get("https://libraries.io/api/github/"+repoOwner+"/"+repoName+"/dependencies?api_key="+req.env.librariesApiKey, function(librariesIoResponse){
    var message;
    return rp.get({
      url: "https://api.github.com/repos/"+repoOwner+"/"+repoName+"?client_id="+req.env.githubClientId+"&client_secret="+req.env.githubClientSecret,
      headers: {'user-agent': 'RepoInfo/0.0.1'}
    })
    .then( function(githubApiResponse) {

      console.log(githubApiResponse);
      var githubApiData = JSON.parse(githubApiResponse);
      console.log('Recieved from github: ' + githubApiData);


      message = "*"+repoOwner+"/"+repoName+"*: \n" + githubApiData.stargazers_count + ":star:, licence: " + githubApiData.license + ", last push: " + githubApiData.pushed_at;

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
      return rp.get('https://slack.com/api/chat.postMessage?token='+dynamoDbResponse.Items[0].bot.bot_access_token+'&channel='+postBody.event.channel+'&text='+encodeURIComponent(message));
    })
    .then( function(postMessageResponse){
      console.log('Successfully sent message to Slack channel: ' + message);
      return postMessageResponse;
    })
    .catch( function(err){
      console.log(err);
      throw "Error: "+err;
    });
  }
});