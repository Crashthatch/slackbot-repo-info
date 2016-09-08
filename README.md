This SlackBot watches in your channels for links to Github and then replies with a summary of the repository, to give you a "health check" of the repository without needing to leave Slack!
It runs serverlessly using AWS Lambda, API Gateway and uses the Slack events API to get notifications when there is a new message to respond to.

Features:

* Number of stars
* Time of last Push
* License
* Age (First commit)
* Number of Dependencies
* Outdated / Deprecated dependencies


TODO (Some using Libraries.io, maybe hook into gemnasium?):

* Package managers this repo is release on (eg. "available on npm, bower") 
* Release Frequency
* Number of regular contributors (Bus count)
* Number of Transitive dependencies (how big is the dependency tree?)
* Issues / Pull requests closed / opened recently
* Transitive licensing issues?
* Github badges / shields: eg. Travis' "Build passing" or the "Dependencies up-to-date" etc. Just scrape the readme for these?
* Security issues? Known bad versions of dependencies? [nodesecurity](https://nodesecurity.io/)
* Avg. time to fix when a vulnerability becomes known?
* Score each area and colour it red/green in the Slack window with formatting
* Code-Climate score?
* Overall health rating? Some function of the above fields.
* A graph of health-ratings? A bad "red" dependency colours the tree that depends on it?
* "Star on Github" button 
* Test coverage (integrate with travis?)
* Change colour of attachment sidebar by sending "color: #ff0000" in chat.postMessage. Red / orange / green for repo health.

See [gorillamania/repo-health](https://github.com/gorillamania/repo-health), [repocheck](http://repocheck.com/), [gemnasium](https://gemnasium.com) and [npmCompare](https://npmcompare.com/compare/jasmine,mocha) for more ideas.



##Installation & Setup

Install claudia in your local path:

    npm install -g claudia
    
And [set up your AWS Credentials](https://claudiajs.com/tutorials/installing.html) if you haven't already.
    
To deploy to AWS Lambda / API Gateway:

    claudia create --region us-east-1 --api-module app --timeout 20 --allow-recursion
    
[Create a new Slack app](https://api.slack.com/apps/) . Use the URL claudia gave you in the last step, plus /slack/oauth as the "Request URL". (eg. https://123456789.execute-api.us-east-1.amazonaws.com/latest/slack/oauth)

[Create a bot user for this app](https://api.slack.com/apps/A254NENDP/bots)
    
You will need to create Stage Variables in the API Gateway (use the AWS Console or AWS API) for the following keys (Slack credentials are found here: https://api.slack.com/apps/A254NENDP/oauth ):

* githubClientSecret
* slackClientSecret
* slackVerificationToken
* githubClientId
* librariesApiKey

In your slack app settings, go to [event subscriptions](https://api.slack.com/apps/A254NENDP/event-subscriptions) and enable bot-events:

* message.channels
* message.groups
* message.im
* message.mpim

Modify the IAM role Claudia created to have read/write permissions for DynamoDB and create a table called "RepoInfoSlackKeys" with the primary index on team_id, user_id. This is where we store slack auth keys when a new user/team adds the repo-info app.
TODO: Use --policies flag to claudia create above to do this automatically (See http://www.marcusoft.net/2016/03/aws-lambda-part-ii-storing-stuff.html)
 

Use the [Slack button creator](https://api.slack.com/docs/slack-button) or edit the code below- insert your app's client_id- to create a button that users can press to add this SlackBot to their own teams and channels.

The bot scope is required, and the bot must be added and then invited into the channels they want to monitor.
These additional scopes allow the bot to listen to all channels that the adding-user has access to without needing to be invited (is it rude to listen / post in channels without an invite?):

* channels:history - listen in all public channels.
* groups:history - listen in private channels that the user who added the bot is in.
* im:history - listen in IM channels for the user who added the bot.

Slack Button code:

    <a href="https://slack.com/oauth/authorize?scope=bot,channels:history&client_id=123456789.0987654321">
    <img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" />
    </a>

Click this button and complete the oAuth process, selecting a slack team & channel that the bot will be added to. If you did not request the channels:history scope, make sure to /invite the bot to a #channel.

To test, paste a link to a github repository into the slack channel, and the bot should reply with info about the linked repository.

##Updating & Debugging
Run ```claudia update``` to build & upload the latest version of the code to lambda / Gateway.

Production logs are available through the [Cloudwatch console](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logs:). Select your lambda function log-group and the latest deployment and look for errors.

##Test Locally
To run tests locally (useful while developing):

    npm install
    npm test
    
##Contributing

* Fork
* Make changes
* Add tests for new behaviour
* Run tests
* Test manually by pushing to lambda (we can't write Jasmine tests for this)
* Commit
* Open Pull-Request