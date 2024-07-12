//requires
const fs = require('fs').promises
const crypto = require('crypto')
const FormData = require('form-data')
const config = require('../config.json')

//code
if (!config.firefish.use) return;
if (config.firefish.use && !config.firefish.instance) return console.log('missing firefish instance');
if (config.firefish.use && !config.firefish.token) return console.log('missing firefish token');

let token = config.firefish.token;
let baseUrl = `https://${config.firefish.instance}`

async function init() {
    let data = await (await fetch(`${baseUrl}/api/i`, {
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
        let file = await fs.readFile(filePath)

        //construct the multipart form data
        let form = new FormData()

        let boundary = `shycatbotFormBoundary${crypto.randomBytes(8).toString('hex')}`
        form.setBoundary(boundary)

        form.append('force', 'true')
        form.append('name', fileName)
        form.append('file', file, {
            filename: fileName,
            contentType: mimeType
        })

        //upload it to the user's drive
        let uploadData = await (await fetch(`${baseUrl}/api/drive/files/create`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': config.userAgent,
                ...form.getHeaders()
            },
            method: 'POST',
            body: form.getBuffer()
        })).json()

        if (!uploadData.id) throw `upload:${JSON.stringify(uploadData)}`;

        //create the post with the media
        let noteBody = JSON.stringify({ text: fileName, fileIds: [ uploadData.id ], localOnly: false, poll: null, visibility: 'home' })
        let noteData = await (await fetch(`${baseUrl}/api/notes/create`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': config.userAgent,
            },
            method: 'POST',
            body: noteBody
        })).json()

        if (!noteData.createdNote) throw `post:${JSON.stringify(noteData)}`;

        return true;
    } catch (err) {
        console.log(`firefish: failed to post ${fileName}`, err)
        console.error('firefish error: ', err)
        return false;
    }
}

module.exports.init = init;
module.exports.post = post;
module.exports.isEnabled = function() {
    return config.firefish.use;
}