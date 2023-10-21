//requires
const fs = require('fs').promises
const crypto = require('crypto')
const config = require('../config.json')

//code
if (!config.tumblr.use) return;
if (config.tumblr.use && !config.tumblr.blog) return console.log('missing tumblr blog');
if (config.tumblr.use && !config.tumblr.consumerKey) return console.log('missing tumblr consumer key');

var done = function() {};

var consumerKey = config.tumblr.consumerKey
var consumerSecret = config.tumblr.consumerSecret
var accessToken;
var blog = config.tumblr.blog

async function init() {
    var tokenData = await (await fetch('https://api.tumblr.com/v2/oauth2/token', {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: consumerKey, client_secret: consumerSecret }),
        method: 'POST'
    })).json()

    if (!tokenData.access_token) {
        console.log('tumblr: failed to log in')
        return false;
    }

    accessToken = `Bearer ${tokenData.access_token}`;

    var data = await (await fetch('https://api.tumblr.com/v2/user/info', {
        headers: {
            'Authorization': accessToken,
            'User-Agent': config.userAgent
        }
    })).json()

    if (data.meta && data.meta.status == 200) {
        console.log(`tumblr: logged in as ${data.response.user.name}, posting to ${blog}`)
        setInterval(refreshToken, config.tumblr.refreshIntervalMs) //refresh token every x amount of time (30 minutes by default)
        return true;
    } else {
        console.log('tumblr: failed to log in')
        return false;
    }
}

async function checkToken() {
    var check = await (await fetch('https://api.tumblr.com/v2/user/info', {
        headers: {
            'Authorization': accessToken,
            'User-Agent': config.userAgent
        }
    })).json()

    if (check.meta && check.meta.status == 200) return true;

    return false;
}

async function refreshToken() {
    var newToken = await (await fetch('https://api.tumblr.com/v2/oauth2/token', {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: consumerKey, client_secret: consumerSecret }),
        method: 'POST'
    })).json()

    if (newToken.access_token) {
        accessToken = `Bearer ${newToken.access_token}`
        return true;
    } else {
        config.tumblr.use = false;
        console.log('tumblr: failed to refresh token, disabled tumblr')
        return false;
    }
}

async function post(fileName, filePath, mimeType) {
    try {
        var tokenValid = await checkToken()
        if (!tokenValid) await refreshToken()

        var file = await fs.readFile(filePath)
        var postType = mimeType.split('/')[0]

        var postJson = {
            content: [
                {
                    type: postType, //"image", "video", "audio"
                    media: { type: mimeType, identifier: 'media' }
                },
                {
                    type: 'text',
                    text: fileName
                }
            ]
        }

        //construct the multipart form data (fuck tumblrs api, what the fuck dude)
        var boundary = `shycatbotFormBoundary${crypto.randomBytes(8).toString('hex')}`

        var jsonBound = `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="json"\r\n` +
        `Content-Type: application/json\r\n\r\n`

        var fileBound = `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="media"; filename="${fileName.replaceAll('"', '\\"')}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`

        var endBoundary = `\r\n--${boundary}--\r\n`;

        var bodyBuffer = Buffer.concat([ Buffer.from(jsonBound), Buffer.from(JSON.stringify(postJson) + '\r\n'), Buffer.from(fileBound), file, Buffer.from(endBoundary) ])

        //create the post, with the form data
        var data = await (await fetch(`https://api.tumblr.com/v2/blog/${blog}/posts`, {
            headers: {
                'Authorization': accessToken,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: bodyBuffer
        })).json()

        if (!data.meta || data.meta.status != 201) throw `post:${JSON.stringify(data)}`;

        done()
    } catch (err) {
        console.log(`tumblr: failed to post ${fileName}`)
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
    return config.tumblr.use;
}