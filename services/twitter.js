//requires
const { TwitterApi } = require('twitter-api-v2') //genuinely HAD to use a library here, could not figure out oauth + media uploads for the life of me
const config = require('../config.json')

//code
if (!config.twitter.use) return;
if (config.twitter.use && !config.twitter.appKey) return console.log('missing twitter keys');

let done = function() {};

let client;

async function init() {
    client = new TwitterApi({
        appKey: config.twitter.appKey,
        appSecret: config.twitter.appSecret,
        accessToken: config.twitter.accessToken,
        accessSecret: config.twitter.accessSecret,
        timeout_ms: 60 * 1000,
        strictSSL: true
    })

    let user = await client.v2.me()

    if (user?.data?.username) {
        console.log(`twitter: logged in as @${user.data.username}`)
        return true;
    } else {
        console.log('twitter: failed to log in')
        return false;
    }
}

async function post(fileName, filePath) {
    try {
        let media = await client.v1.uploadMedia(filePath)
        await client.v2.tweet(fileName, { media: { media_ids: [ media ] } })
        done()
    } catch (err) {
        console.log(`twitter: failed to post ${fileName}`)
        console.error(err)
        done()
    }
}

module.exports.init = init;
module.exports.post = post;
module.exports.onDone = function(callback) {
    done = callback;
}
module.exports.isEnabled = function() {
    return config.twitter.use;
}