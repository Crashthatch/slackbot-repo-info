'use strict'

const fs = require('fs');
const AWS = require('aws-sdk');
const rp = require('request-promise');
const Promise = require('bluebird');
var app = require('../app.js');
var testEnv = {
  slackClientId: 'SlackAppId',
  slackClientSecret: 'SlackAppSecret',
  slackVerificationToken: 'SlackAppVerificationToken',

  librariesApiKey: 'librariesIoApiKey',

  githubClientId: 'githubClientId',
  githubClientSecret: 'gitHubClientSecret'
};

var githubRepoResponse = fs.readFileSync('spec/githubRepoResponse.json').toString();


var lambdaContextSpy, getAjaxSpy, dynamoDbSpy, messagePosted;
beforeEach(function() {
  lambdaContextSpy = jasmine.createSpyObj('lambdaContext', ['done']);

  messagePosted = null;
  //Mock AJAX responses...
  getAjaxSpy = rp.get = jasmine.createSpy().and.callFake(function (requestGetArgument) {
    var urlRequested = ( typeof requestGetArgument == "string") ? requestGetArgument : requestGetArgument.url;

    if (urlRequested.match(/^https:\/\/api\.github\.com\/repos/)) {
      return Promise.resolve(githubRepoResponse);
    }
    else if (urlRequested.match(/https:\/\/slack\.com\/api\/chat\.postMessage/)) {
      var queryParams = urlRequested.match(/https:\/\/slack\.com\/api\/chat\.postMessage.*text=(.*)(&|$)/);
      messagePosted = decodeURIComponent(queryParams[1]);
      return Promise.resolve("OK"); //TODO: Replace this with what Slack actually responds with.
    }
  });
  dynamoDbSpy = AWS.DynamoDB.DocumentClient = jasmine.createSpy().and.callFake(function () {
    return {
      queryAsync: function () {
        return Promise.resolve({
          Items: [{
            "access_token": "xoxp-71297134288-1234567890-1234567890-de567890",
            "bot": {
              "bot_access_token": "xoxb-1234567890-D5jgfdi5gfjnDFDeFE",
              "bot_user_id": "U25LNU007"
            },
            "ok": true,
            "scope": "identify,bot,commands,incoming-webhook,channels:history",
            "team_id": "T238RTOM",
            "team_name": "Tom Test",
            "user_id": "U238USER"
          }]
        });
      }
    }
  });
});

describe('Slack', function() {

  //TODO: Test oAuth endpoint.


  describe('newMessage', () => {

    it('returns challenge if type is url_verification', function () {
      app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'type': 'url_verification',
          'challenge': 'I_SHOULD_BE_ECHOED',
          'token': 'SlackAppVerificationToken'
        },
        env: testEnv
      }, lambdaContextSpy);

      expect(lambdaContextSpy.done).toHaveBeenCalledWith(null, 'I_SHOULD_BE_ECHOED');
    });

    it('Calls the Github API to get details for the right repo.', (done) => {
      var routerPromise = app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'token': 'SlackAppVerificationToken',
          'type': 'message',
          'event': {
            text: 'http://github.com/someUser/someRepo'
          }
        },
        env: testEnv
      }, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/someUser\/someRepo\?/);
        done();
      });
    });

    it('Recognises https:// github repos.', (done) => {
      var routerPromise = app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'token': 'SlackAppVerificationToken',
          'type': 'message',
          'event': {
            text: 'https://github.com/testUser/testRepo'
          }
        },
        env: testEnv
      }, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/testUser\/testRepo\?/);
        done();
      });
    });

    it('Recognises github repos without http:// at all.', (done) => {
      var routerPromise = app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'token': 'SlackAppVerificationToken',
          'type': 'message',
          'event': {
            text: 'github.com/testUser/testRepo'
          }
        },
        env: testEnv
      }, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/testUser\/testRepo\?/);
        done();
      });
    });

    it('Parses a github repo from the middle of a slack message.', (done) => {
      var routerPromise = app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'token': 'SlackAppVerificationToken',
          'type': 'message',
          'event': {
            text: 'Hey everyone this is \"my\" more \n complicated message that also references a github repo. http://github.com/testUser/testRepo/blob/master/fonts/ionicons.ttf'
          }
        },
        env: testEnv
      }, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/testUser\/testRepo\?/);
        done();
      });
    });

    it('Tries to make post to slack, given appropriate responses from github, dynamoDb etc.', (done) => {
      var routerPromise = app.router({
        context: {
          path: '/slack/newMessage',
          method: 'POST'
        },
        body: {
          'token': 'SlackAppVerificationToken',
          'type': 'message',
          'event': {
            text: 'http://github.com/testUser/testRepo'
          }
        },
        env: testEnv
      }, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(lambdaContextSpy.done).toHaveBeenCalled();
        expect(messagePosted).toMatch(/\*testUser\/testRepo\*.*/);
        done();
      })

    });
  });
});