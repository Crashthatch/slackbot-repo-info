var app = require('../app.js');
var testEnv = {
  slackClientId: 'SlackAppId',
  slackClientSecret: 'SlackAppSecret',
  slackVerificationToken: 'SlackAppVerificationToken',

  librariesApiKey: 'librariesIoApiKey',

  githubClientId: 'githubClientId',
  githubClientSecret: 'gitHubClientSecret'
};


var lambdaContextSpy;
beforeEach(function(){
  lambdaContextSpy = jasmine.createSpyObj('lambdaContext', ['done']);
  
});

describe('Slack', function() {
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
  });
});