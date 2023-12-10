//requires
const fs = require('fs').promises
const crypto = require('crypto')
const config = require('../config.json')

//code
if (!config.firefish.use) return;
if (config.firefish.use && !config.firefish.instance) return console.log('missing firefish instance');
if (config.firefish.use && !config.firefish.token) return console.log('missing firefish token');

var done = function() {};

var token = config.firefish.token;
var baseUrl = `https://${config.firefish.instance}`

async function init() {
    var data = await (await fetch(`${baseUrl}/api/i`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': config.userAgent
        },
        method: 'POST'
    })).json()

    if (data.id) {
        console.log(`firefish: logged in as @${data.username}@${config.firefish.instance}`)
        return true;
    } else {
        console.log(`firefish: failed to log in`)
        return false;
    }
}

async function post(fileName, filePath, mimeType) {
    try {
        var file = await fs.readFile(filePath)

        //construct the multipart form data
        var boundary = `shycatbotFormBoundary${crypto.randomBytes(8).toString('hex')}`
        var body = ''

        body += `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="force"\r\n\r\n` +
        `true`

        body += `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="name"\r\n\r\n` +
        `${fileName.replaceAll('"', '\\"')}`

        body += `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName.replaceAll('"', '\\"')}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`

        var endBoundary = `\r\n--${boundary}--\r\n`;

        var bodyBuffer = Buffer.concat([ Buffer.from(body), file, Buffer.from(endBoundary) ])

        //upload it to the user's drive
        var uploadData = await (await fetch(`${baseUrl}/api/drive/files/create`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'User-Agent': config.userAgent,
            },
            method: 'POST',
            body: bodyBuffer
        })).json()

        if (!uploadData.id) throw `upload:${JSON.stringify(uploadData)}`;

        //create the post with the media
        var noteBody = JSON.stringify({ text: fileName, fileIds: [ uploadData.id ], localOnly: false, poll: null, visibility: 'home' })
        var noteData = await (await fetch(`${baseUrl}/api/notes/create`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': config.userAgent,
            },
            method: 'POST',
            body: noteBody
        })).json()

        if (!noteData.createdNote) throw `post:${JSON.stringify(noteData)}`;

        done()
    } catch (err) {
        console.log(`firefish: failed to post ${fileName}`)
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
    return config.firefish.use;
}