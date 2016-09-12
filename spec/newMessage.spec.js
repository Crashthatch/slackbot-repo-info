'use strict'

const fs = require('fs');
const AWS = require('aws-sdk');
const rp = require('request-promise');
const Promise = require('bluebird');
const _ = require('lodash');
var app = require('../app.js');

var testEvent = {
  doLongTask: true,
  originalReq: {
    context: {
      path: '/slack/newMessage',
      method: 'POST'
    },
    body: {
      'token': 'SlackAppVerificationToken',
      'type': 'message',
      'event': {
        text: 'http://github.com/octocat/hello-world'
      }
    },
    env: {
      slackClientId: 'SlackAppId',
      slackClientSecret: 'SlackAppSecret',
      slackVerificationToken: 'SlackAppVerificationToken',

      librariesApiKey: 'librariesIoApiKey',

      githubClientId: 'githubClientId',
      githubClientSecret: 'gitHubClientSecret'
    }
  }
};

var githubRepoResponse = fs.readFileSync('spec/githubRepoResponse.json').toString();
var librariesIoDependenciesResponse = fs.readFileSync('spec/librariesIoDependenciesResponse.json').toString();
var librariesIo404 = fs.readFileSync('spec/librariesIo404.json').toString();


var lambdaContextSpy, getAjaxSpy, postAjaxSpy, dynamoDbSpy, attachmentPosted;
beforeEach(function() {
  lambdaContextSpy = jasmine.createSpyObj('lambdaContext', ['done']);

  attachmentPosted = null;
  //Mock AJAX responses...
  getAjaxSpy = rp.get = jasmine.createSpy().and.callFake(function (requestGetArgument) {
    var urlRequested = ( typeof requestGetArgument == "string") ? requestGetArgument : requestGetArgument.url;

    if (urlRequested.match(/^https:\/\/api\.github\.com\/repos/)) {
      return Promise.resolve(githubRepoResponse);
    }
    else if(urlRequested.match(/^https:\/\/libraries.io\/api\/github\/notalibrary\/librariesdoesntknow\/dependencies/)){
      return Promise.reject(JSON.parse(librariesIo404));
    }
    else if(urlRequested.match(/^https:\/\/libraries.io\/api\/github\/.*\/dependencies/)){
      return Promise.resolve(librariesIoDependenciesResponse);
    }
    else{
      return Promise.reject("Mock does not know how to respond to "+urlRequested);
    }
  });

  postAjaxSpy = rp.post = jasmine.createSpy().and.callFake(function (urlRequested, postFormData) {
    if (urlRequested.match(/https:\/\/slack\.com\/api\/chat\.postMessage/)) {
      var regexMatch = postFormData.form.match(/attachments=(.*)(&|$)/);
      attachmentPosted = JSON.parse(regexMatch[1])[0];
      return Promise.resolve('{"ok": true}');
    }
    else{
      return Promise.reject("Mock does not know how to respond to "+urlRequested);
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
        context: testEvent.originalReq.context,
        body: {
          'type': 'url_verification',
          'challenge': 'I_SHOULD_BE_ECHOED',
          'token': 'SlackAppVerificationToken'
        },
        env: testEvent.originalReq.env
      }, lambdaContextSpy);

      expect(lambdaContextSpy.done).toHaveBeenCalledWith(null, 'I_SHOULD_BE_ECHOED');
    });

    it('Calls the Github API to get details for the right repo.', (done) => {
      var testEventModified = _.cloneDeep(testEvent);
      testEventModified.originalReq.body.event.text = 'http://github.com/octocat/hello-world';
      var routerPromise = app.router(testEventModified, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/octocat\/hello-world\?/);
        done();
      });
    });

    it('Recognises https:// github repos.', (done) => {
      var testEventModified = _.cloneDeep(testEvent);
      testEventModified.originalReq.body.event.text = 'https://github.com/octocat/hello-world';
      var routerPromise = app.router(testEventModified, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/octocat\/hello-world\?/);
        done();
      });
    });

    it('Recognises github repos without http:// at all.', (done) => {
      var testEventModified = _.cloneDeep(testEvent);
      testEventModified.originalReq.body.event.text = 'github.com/octocat/hello-world';
      var routerPromise = app.router(testEventModified, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/octocat\/hello-world\?/);
        done();
      });
    });

    it('Parses a github repo from the middle of a slack message.', (done) => {
      var testEventModified = _.cloneDeep(testEvent);
      testEventModified.originalReq.body.event.text = 'Hey everyone this is \"my\" more \n complicated message that also references a github repo. http://github.com/octocat/hello-world/blob/master/fonts/ionicons.ttf';
      var routerPromise = app.router(testEventModified, lambdaContextSpy);

      routerPromise.then( function() {
        expect(getAjaxSpy).toHaveBeenCalled();
        expect(getAjaxSpy.calls.first().args[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/octocat\/hello-world\?/);
        done();
      });
    });

    it('Tries to make post to slack, given appropriate responses from github, dynamoDb etc.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(postAjaxSpy).toHaveBeenCalled();
        expect(attachmentPosted.title).toMatch(/octocat\/hello-world/i);
        done();
      })
    });

    it('Posts to Slack, even when response from libraries.io fails.', (done) => {
      var testEventModified = _.cloneDeep(testEvent);
      testEventModified.originalReq.body.event.text = 'http://github.com/notalibrary/librariesdoesntknow';

      var routerPromise = app.router(testEventModified, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(postAjaxSpy).toHaveBeenCalled();
        expect(attachmentPosted).not.toBeNull();
        expect(attachmentPosted.title).toMatch(/octocat\/hello-world/i);
        done();
      })
    });

    /*Removed because we no longer return anything from the background lambda process.
    it('returns a success', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(lambdaContextSpy.done).toHaveBeenCalledWith(null, "OK"); //null as first argument means "success" (and causes API gateway to respond 200).
        done();
      })
    });*/

    it('attachmentPosted.text Contains the number of stars the repo has.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(attachmentPosted.text).toMatch(/806412/);
        done();
      })
    });

    it('attachmentPosted.text Contains the license.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(attachmentPosted.text).toMatch(/OtherLicense/);
        done();
      })
    });

    it('attachmentPosted.text contains the number of dependencies.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(attachmentPosted.text).toMatch(/25 dependencies/);
        done();
      });
    });

    it('attachmentPosted.text contains the number of outdated dependencies.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(attachmentPosted.text).toMatch(/9 outdated/);
        done();
      });
    });

    it('attachmentPosted.text uses friendly dates.', (done) => {
      var routerPromise = app.router(testEvent, lambdaContextSpy);

      //Wait for our lambda function to complete.
      routerPromise.then( function(){
        expect(attachmentPosted.text).toMatch(/years ago/);
        done();
      })
    });

    it('rejects the promise if slack chat.postMessage responds 200 "not ok".', (done) => {
      //Override rp.post to return an error from Slack.
      var failPostAjaxSpy = rp.post = jasmine.createSpy().and.callFake(function (urlRequested, postFormData) {
        if (urlRequested.match(/https:\/\/slack\.com\/api\/chat\.postMessage/)) {
          return Promise.resolve('{"ok": false, "error": "Authentication Error"}');
        }
        else{
          return Promise.reject("Mock does not know how to respond to "+urlRequested);
        }
      });

      var routerPromise = app.router(testEvent, lambdaContextSpy);

      routerPromise.then( function(routerResponse){
        expect(lambdaContextSpy.done).toHaveBeenCalled();
        expect(lambdaContextSpy.done).not.toHaveBeenCalledWith(null); //not null as the first argument means "error", and API gateway will respond 500.
        done();
      });
    });

    it('rejects the promise if slack chat.postMessage responds 500 error.', (done) => {
      //Override rp.post to return an error from Slack.
      var failPostAjaxSpy = rp.post = jasmine.createSpy().and.callFake(function (urlRequested, postFormData) {
        if (urlRequested.match(/https:\/\/slack\.com\/api\/chat\.postMessage/)) {
          return Promise.reject('connection error');
        }
        else{
          return Promise.reject("Mock does not know how to respond to "+urlRequested);
        }
      });

      var routerPromise = app.router(testEvent, lambdaContextSpy);

      routerPromise.then( function(routerResponse){
        expect(lambdaContextSpy.done).toHaveBeenCalled();
        expect(lambdaContextSpy.done).not.toHaveBeenCalledWith(null); //not null as the first argument means "error", and API gateway will respond 500.
        done();
      });
    });
  });
});