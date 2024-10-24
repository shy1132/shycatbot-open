//requires
const fs = require('fs').promises
const crypto = require('crypto')
const FormData = require('form-data')
const config = require('../config.json')

//code
if (!config.mastodon.use) return;
if (config.mastodon.use && !config.mastodon.instance) return console.log('missing mastodon instance');
if (config.mastodon.use && !config.mastodon.accessToken) return console.log('missing mastodon client key');

let accessToken = config.mastodon.accessToken;
let baseUrl = `https://${config.mastodon.instance}`

async function init() {
    let data = await (await fetch(`${baseUrl}/api/v1/apps/verify_credentials`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': config.userAgent
        }
    })).json()

    if (!data.error) {
        console.log(`mastodon: logged in as @${data.name}@${config.mastodon.instance}`)
        return true;
    } else {
        console.log(`mastodon: failed to log in`)
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

        form.append('file', file, {
            filename: fileName,
            contentType: mimeType
        })

        //upload it to the instance's api
        let uploadData = await (await fetch(`${baseUrl}/api/v2/media`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': config.userAgent,
                ...form.getHeaders()
            },
            method: 'POST',
            body: form.getBuffer()
        })).json()

        if (!uploadData.id) throw `upload:${JSON.stringify(uploadData)}`;

        if (!uploadData.url) await waitForUpload(); //if the upload data doesnt return a url, wait until one is available

        async function waitForUpload() { //recursively check the progress every second and wait until its done processing
            //nesting hell
            try {
                return await new Promise(async (resolve, reject) => {
                    async function check() {
                        let data = await (await fetch(`${baseUrl}/api/v1/media/${uploadData.id}`, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'User-Agent': config.userAgent
                            }
                        })).json()
            
                        if (data.url) {
                            return resolve(true);
                        } else if (!data.id) { //will always have this
                            throw `uploadProgress:${JSON.stringify(data)}`;
                        } else if (!data.url) {
                            setTimeout(async () => await check(), 1000)
                        }
                    }
    
                    await check()
                })
            } catch (err) {
                throw err;
            }
        }

        //create the post with the media
        let statusBody = JSON.stringify({ status: fileName, content_type: 'text/markdown', in_reply_to_id: null, media_ids: [ uploadData.id ], sensitive: false, spoiler_text: '', visibility: 'unlisted', poll: null, language: 'en' })
        let statusData = await (await fetch(`${baseUrl}/api/v1/statuses`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': config.userAgent,
            },
            method: 'POST',
            body: statusBody
        })).json()

        if (!statusData.id) throw `post:${JSON.stringify(statusData)}`;

        return true;
    } catch (err) {
        console.log(`mastodon: failed to post ${fileName}`, err)
        console.error('mastodon error: ', err)
        return false;
    }
}

module.exports.init = init;
module.exports.post = post;
module.exports.isEnabled = function() {
    return config.mastodon.use;
}