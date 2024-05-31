//requires
const fs = require('fs').promises
const crypto = require('crypto')
const util = require('util')
const FormData = require('form-data')
const config = require('../config.json')

//code
if (!config.cohost.use) return;
if (config.cohost.use && !config.cohost.password) return console.log('missing cohost password');
if (config.cohost.use && !config.cohost.email) return console.log('missing cohost email');
if (config.cohost.handle.startsWith('@')) config.cohost.handle = config.cohost.handle.substr(1);

const pbkdf2 = util.promisify(crypto.pbkdf2)
let done = function() {};

let cookie;

async function init() {
    let jsonBody = {
        '0': {
            email: config.cohost.email
        }
    }

    //get the salt from the server
    let saltData = await (await fetch(`https://cohost.org/api/v1/trpc/login.getSalt?batch=1&input=${encodeURIComponent(JSON.stringify(jsonBody))}`, {
        headers: {
            'User-Agent': config.userAgent
        }
    })).json()

    if (!saltData[0]?.result?.data?.salt) {
        console.log('cohost: failed to log in')
        return false;
    }

    //convert the salt to a buffer, from a base64 string
    let salt = Buffer.from(saltData[0].result.data.salt.replaceAll('-', 'A').replaceAll('_', 'A'), 'base64')

    let pbkdf2Parameters = {
        password: Buffer.from(config.cohost.password, 'utf-8'),
        salt,
        iterations: 2e5,
        keylen: 128,
        digest: 'sha384'
    }

    //hash the password
    let hashedPassword = await pbkdf2(pbkdf2Parameters.password, pbkdf2Parameters.salt, pbkdf2Parameters.iterations, pbkdf2Parameters.keylen, pbkdf2Parameters.digest)
    hashedPassword = hashedPassword.toString('base64')

    jsonBody[0].clientHash = hashedPassword;

    //log in with the hashed password
    let loginResponse = await fetch('https://cohost.org/api/v1/trpc/login.login?batch=1', {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': config.userAgent
        },
        method: 'POST',
        body: JSON.stringify(jsonBody)
    })

    let loginData = await loginResponse.json()

    if (loginData[0]?.result?.data?.userId) {
        cookie = loginResponse.headers.get('set-cookie')
        console.log(`cohost: logged in as userId ${loginData[0].result.data.userId} (${config.cohost.email})`)
        return true;
    } else {
        console.log('cohost: failed to log in')
        return false;
    }
}

async function post(fileName, filePath, mimeType) {
    try {
        let file = await fs.readFile(filePath)

        //create a post
        let postJson = {
            '0': {
                projectHandle: config.cohost.handle,
                content: {
                    postState: 1,
                    headline: fileName,
                    adultContent: false,
                    blocks: [
                        {
                            type: 'attachment',
                            attachment: {
                                attachmentId: '00000000-0000-0000-0000-000000000000',
                                altText: ''
                            }
                        }
                    ],
                    cws: [],
                    tags: []
                }
            }
        }

        let postCreate = await (await fetch('https://cohost.org/api/v1/trpc/posts.create?batch=1', {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: JSON.stringify(postJson)
        })).json()

        if (!postCreate[0]?.result?.data?.postId) throw `postCreate:${JSON.stringify(postCreate)}`;
        let postId = postCreate[0].result.data.postId

        //tell the cohost api about the attachment
        let attachmentStart = await (await fetch('https://cohost.org/api/v1/trpc/posts.attachment.start?batch=1', {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: JSON.stringify({
                '0': {
                    projectHandle: config.cohost.handle,
                    postId,
                    filename: fileName,
                    contentType: mimeType,
                    contentLength: file.length
                }
            })
        })).json()

        if (!attachmentStart[0]?.result?.data?.attachmentId) throw `attachmentStart:${JSON.stringify(attachmentStart)}`;
        let attachment = attachmentStart[0].result.data
        let attachmentId = attachment.attachmentId

        //construct the multipart form data
        let form = new FormData()

        let boundary = `shycatbotFormBoundary${crypto.randomBytes(8).toString('hex')}`
        form.setBoundary(boundary)

        for (let key of Object.keys(attachment.requiredFields)) {
            let value = attachment.requiredFields[key]
            form.append(key, value)
        }

        form.append('file', file, {
            filename: fileName,
            contentType: mimeType
        })

        //upload the multipart form data (including the file) to the cohost cdn
        let upload = await fetch('https://staging.cohostcdn.org/redcent-dev', {
            headers: {
                'User-Agent': config.userAgent,
                ...form.getHeaders()
            },
            method: 'POST',
            body: form.getBuffer()
        })

        if (upload.status != 204) {
            let uploadData = await upload.text()
            throw `upload:${uploadData}`;
        }

        //tell the cohost api that the attachment is uploaded
        let attachmentFinish = await (await fetch('https://cohost.org/api/v1/trpc/posts.attachment.finish?batch=1', {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: JSON.stringify({
                '0': {
                    projectHandle: config.cohost.handle,
                    postId,
                    attachmentId
                }
            })
        })).json()

        if (!attachmentFinish[0]?.result?.data?.attachmentId) throw `attachmentFinish:${JSON.stringify(attachmentFinish)}`;

        //update the original post with the attachment id of our uploaded attachment
        postJson[0].content.blocks[0].attachment.attachmentId = attachmentId;
        postJson[0].postId = postId;

        let postUpdate = await fetch('https://cohost.org/api/v1/trpc/posts.update?batch=1', {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'User-Agent': config.userAgent
            },
            method: 'POST',
            body: JSON.stringify(postJson)
        })

        if (!postUpdate.ok) {
            let postUpdateData = await postUpdate.json()
            throw `postUpdate:${JSON.stringify(postUpdateData)}`;
        }

        done()
    } catch (err) {
        console.log(`cohost: failed to post ${fileName}`, err)
        console.error('cohost error: ', err)
        done()
    }
}

module.exports.init = init;
module.exports.post = post;
module.exports.onDone = function(callback) {
    done = callback;
}
module.exports.isEnabled = function() {
    return config.cohost.use;
}