//requires
const fs = require('fs').promises
const config = require('../config.json')

//code
if (!config.bluesky.use) return;
if (config.bluesky.use && !config.bluesky.appPassword) return console.log('missing bluesky app password');
if (config.bluesky.use && !config.bluesky.handle) return console.log('missing bluesky handle');
if (config.bluesky.handle.startsWith('@')) config.bluesky.handle = config.bluesky.handle.substr(1);

let done = function() {};

let session = {
    accessJwt: null,
    refreshJwt: null,
    handle: null
}

async function init() {
    let data = await (await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        },
        method: 'POST',
        body: JSON.stringify({ identifier: config.bluesky.handle, password: config.bluesky.appPassword })
    })).json()

    if (data.accessJwt) {
        session.accessJwt = data.accessJwt;
        session.refreshJwt = data.refreshJwt;
        session.handle = data.handle;
        console.log(`bluesky: logged in as ${session.handle}`)

        setInterval(refreshSession, config.bluesky.refreshIntervalMs) //refresh session every x amount of time (30 minutes by default)

        return true;
    } else {
        console.log(`bluesky: failed to log in`)
        return false;
    }
}

async function checkSession() {
    let check = await fetch('https://bsky.social/xrpc/com.atproto.server.getSession', {
        headers: {
            'Authorization': `Bearer ${session.accessJwt}`,
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        }
    })

    if (check.ok) return true; //itll return a 200 when successful

    return false;
}

async function refreshSession() {
    //console.log('bluesky: refreshing session')

    let refresh = await (await fetch('https://bsky.social/xrpc/com.atproto.server.refreshSession', {
        headers: {
            'Authorization': `Bearer ${session.refreshJwt}`,
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        },
        method: 'POST'
    })).json()

    if (refresh.accessJwt) {
        session.accessJwt = refresh.accessJwt;
        session.refreshJwt = refresh.refreshJwt;
        session.handle = refresh.handle;
        //console.log('bluesky: session refreshed')
        return true;
    } else {
        config.bluesky.use = false;
        console.log('bluesky: failed to refresh session, disabled bluesky')
        return false;
    }
}

async function post(fileName, filePath, mimeType) {
    try {
        let sessionValid = await checkSession()
        if (!sessionValid) await refreshSession()

        let file = await fs.readFile(filePath)

        //upload the file (they dont use multipart form data for some reason, but i dont mind i hate that shit)
        let upload = await (await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
            headers: {
                'Authorization': `Bearer ${session.accessJwt}`,
                'Content-Type': mimeType,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: file
        })).json()

        if (!upload.blob) throw `upload:${JSON.stringify(upload)}`;

        //create the post with the media
        let postBody = JSON.stringify({
            collection: 'app.bsky.feed.post',
            repo: config.bluesky.handle,
            record: {
                $type: 'app.bsky.feed.post',
                createdAt: new Date().toISOString(),
                text: fileName,
                embed: {
                    $type: 'app.bsky.embed.images',
                    images: [
                        { alt: '', image: upload.blob }
                    ]
                }
            }
        })

        let post = await (await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
            headers: {
                'Authorization': `Bearer ${session.accessJwt}`,
                'Content-Type': 'application/json',
                'User-Agent': config.userAgent
            },
            body: postBody,
            method: 'POST'
        })).json()

        if (!post.uri) throw `post:${JSON.stringify(post)}`;

        done()
    } catch (err) {
        console.log(`bluesky: failed to post ${fileName}`, err)
        console.error('bluesky error: ', err)
        done()
    }
}

module.exports.init = init;
module.exports.post = post;
module.exports.onDone = function(callback) {
    done = callback;
}
module.exports.isEnabled = function() {
    return config.bluesky.use;
}