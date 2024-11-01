//requires
const fs = require('fs').promises
const crypto = require('crypto')
const FormData = require('form-data')
const oauthSign = require('oauth-sign')
const config = require('../config.json')

//code
if (!config.twitter.use) return;
if (config.twitter.use && (!config.twitter.password || !config.twitter.username)) return console.log('missing twitter user/pw');

let consumerKey = 'IQKbtAYlXLripLGPWd0HUA'
let consumerSecret = 'GgDYlkSvaPxGxC4X8liwpUoqKwwr3lCADbz8A7ADU'
let bearerToken = `Bearer AAAAAAAAAAAAAAAAAAAAAAj4AQAAAAAAPraK64zCZ9CSzdLesbE7LB%2Bw4uE%3DVJQREvQNCZJNiz3rHO7lOXlkVOQkzzdsgu6wWgcazdMUaGoUGm`

let iosHeaders = {
    'User-Agent': 'Twitter-iPhone/6.13.6 iOS/6.1.6 (Apple;iPhone2,1;;;;;1)',
    'X-Client-UUID': crypto.randomUUID().toUpperCase(),
    'X-Twitter-API-Version': '5',
    'X-Twitter-Client': 'Twitter-iPhone',
    'X-Twitter-Client-DeviceID': crypto.randomUUID().toUpperCase(),
    'X-Twitter-Client-Limit-Ad-Tracking': '1',
    'X-Twitter-Client-Version': '6.13.6'
}

let auth = {}

async function init() {
    let res = await fetch('https://api.twitter.com/oauth/access_token', {
        headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Accept-Language': 'en',
            'Authorization': bearerToken,
            'Content-Type': 'application/x-www-form-urlencoded',
            ...iosHeaders
        },
        method: 'POST',
        body: `x_auth_login_challenge=true&x_auth_login_verification=true&x_auth_mode=client_auth&x_auth_password=${encodeURIComponent(config.twitter.password)}&x_auth_username=${encodeURIComponent(config.twitter.username)}`
    })

    let data = await res.text()

    if (data.startsWith('{') && res.ok) {
        let json = JSON.parse(data)
        auth = json;

        console.log(`twitter: logged in as @${json.screen_name}`)

        return true;
    } else if (data === 'Login denied due to suspicious activity. Please check your email for further login instructions.') {
        console.log('twitter: failed to log in (check the account\'s email)')
        return false;
    } else {
        console.log('twitter: failed to log in')
        return false;
    }
}

async function post(fileName, filePath, mimeType) {
    try {
        let stat = await fs.stat(filePath)
        let file = await fs.readFile(filePath)

        let mediaId;

        if (mimeType.startsWith('image/') && mimeType != 'image/gif') {
            let form = new FormData()
            form.setBoundary(`com.aTeBiTs.TwEeTiE.${randomString(20)}`)
            form.append('media', file, {
                filename: fileName,
                contentType: mimeType
            })

            let uploadRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
                headers: {
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'en',
                    'Authorization': oauth('POST', 'https://upload.twitter.com/1.1/media/upload.json'),
                    ...form.getHeaders(),
                    ...iosHeaders
                },
                method: 'POST',
                body: form.getBuffer()
            })

            let uploadData = await uploadRes.json()
            if (!uploadData.media_id_string) throw `upload:${JSON.stringify(uploadData)}`;

            mediaId = uploadData.media_id_string
        } else { //im so sorry for this hellcode
            let initUrl = new URL('https://upload.twitter.com/1.1/media/upload.json')
            initUrl.searchParams.append('command', 'INIT')
            initUrl.searchParams.append('media_type', mimeType)
            initUrl.searchParams.append('total_bytes', stat.size)
            if (mimeType == 'image/gif') {
                initUrl.searchParams.append('media_category', 'tweet_gif')
            } else if (mimeType.startsWith('video/')) {
                initUrl.searchParams.append('media_category', 'tweet_video')
            }

            let initRes = await fetch(initUrl.href, {
                headers: {
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'en',
                    'Authorization': oauth('POST', initUrl.href),
                    ...iosHeaders
                },
                method: 'POST'
            })

            let initData = await initRes.json()
            if (!initData.media_id_string) throw `upload-init:${JSON.stringify(initData)}`;

            mediaId = initData.media_id_string;

            let chunks = []
            let chunkSize = 8 * 1024 * 1024;
            for (let i = 0; i < file.length; i += chunkSize) {
                chunks.push(file.slice(i, i + chunkSize))
            }

            for (let i = 0; i < chunks.length; i++) {
                let chunk = chunks[i]

                let form = new FormData()
                form.setBoundary(`com.aTeBiTs.TwEeTiE.${randomString(20)}`)
                form.append('media', chunk, {
                    filename: fileName,
                    contentType: mimeType
                })

                let appendUrl = new URL('https://upload.twitter.com/1.1/media/upload.json')
                appendUrl.searchParams.append('command', 'APPEND')
                appendUrl.searchParams.append('media_id', mediaId)
                appendUrl.searchParams.append('segment_index', i)

                let appendRes = await fetch(appendUrl.href, {
                    headers: {
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate',
                        'Accept-Language': 'en',
                        'Authorization': oauth('POST', appendUrl.href),
                        ...iosHeaders,
                        ...form.getHeaders()
                    },
                    method: 'POST',
                    body: form.getBuffer()
                })

                if (!appendRes.ok) throw `upload-append:${await appendRes.text()}`;
            }

            let finalizeUrl = new URL('https://upload.twitter.com/1.1/media/upload.json')
            finalizeUrl.searchParams.append('command', 'FINALIZE')
            finalizeUrl.searchParams.append('media_id', mediaId)

            let finalizeRes = await fetch(finalizeUrl.href, {
                headers: {
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'en',
                    'Authorization': oauth('POST', finalizeUrl.href),
                    ...iosHeaders
                },
                method: 'POST'
            })

            let finalizeData = await finalizeRes.json()
            if (!finalizeData.media_id_string) throw `upload-finalize:${JSON.stringify(finalizeData)}`;

            async function waitForUpload() { //recursively check the progress when it wants and wait until its done processing
                //nesting hell
                try {
                    return await new Promise(async (resolve, reject) => {
                        async function check() {
                            let statusUrl = new URL('https://upload.twitter.com/1.1/media/upload.json')
                            statusUrl.searchParams.append('command', 'STATUS')
                            statusUrl.searchParams.append('media_id', mediaId)

                            let statusRes = await fetch(statusUrl.href, {
                                headers: {
                                    'Accept': '*/*',
                                    'Accept-Encoding': 'gzip, deflate',
                                    'Accept-Language': 'en',
                                    'Authorization': oauth('GET', statusUrl.href),
                                    ...iosHeaders
                                }
                            })

                            let statusData = await statusRes.json()

                            if (!statusData.media_id_string || (statusData.processing_info.state != 'pending' && statusData.processing_info.state != 'in_progress' && statusData.processing_info.state != 'succeeded')) {
                                reject(`upload-status:${JSON.stringify(statusData)}`)
                            } else if (statusData.processing_info.state == 'succeeded') {
                                resolve()
                            } else {
                                setTimeout(async () => await check(), statusData.processing_info.check_after_secs * 1000)
                            }
                        }

                        await check()
                    })
                } catch (err) {
                    throw err;
                }
            }

            await waitForUpload()
        }

        let params = {
            cards_platform: 'iPhone-10',
            contributor_details: '1',
            include_cards: '1',
            include_entities: '1',
            include_media_features: '1',
            include_my_retweet: '1',
            include_user_entities: 'true',
            media_ids: mediaId,
            status: fileName
        }

        let body = ''
        for (let [ key, value ] of Object.entries(params)) {
            body += `${rfc3986encode(key)}=${rfc3986encode(value)}&`
        }

        body = body.slice(0, -1)

        let postRes = await fetch('https://api.twitter.com/1.1/statuses/update.json', {
            headers: {
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate',
                'Accept-Language': 'en',
                'Authorization': oauth('POST', 'https://api.twitter.com/1.1/statuses/update.json', params),
                'Content-Type': 'application/x-www-form-urlencoded',
                ...iosHeaders
            },
            method: 'POST',
            body
        })

        let postData = await postRes.json()
        if (!postData.id_str) throw `post:${JSON.stringify(postData)}`

        return true;
    } catch (err) {
        console.log(`twitter: failed to post ${fileName}`, err)
        console.error('twitter error: ', err)
        return false;
    }
}

function oauth(method = 'GET', url, bodyParams = {}) {
    let urlObj = new URL(url)

    let timestamp = Math.floor(Date.now() / 1000)
    let nonce = crypto.randomUUID().toUpperCase()

    let params = {}
    for (let [ key, value ] of urlObj.searchParams.entries()) {
        params[key] = value;
    }

    for (let [ key, value ] of Object.entries(bodyParams)) {
        params[key] = value;
    }

    params['oauth_timestamp'] = timestamp;
    params['oauth_version'] = '1.0'
    params['oauth_consumer_key'] = consumerKey;
    params['oauth_token'] = auth.oauth_token;
    params['oauth_nonce'] = nonce;
    params['oauth_signature_method'] = 'HMAC-SHA1'

    let signature = oauthSign.hmacsign(method, `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`, params, consumerSecret, auth.oauth_token_secret)
    let authorization = `OAuth oauth_timestamp="${timestamp}", oauth_version="1.0", oauth_consumer_key="${consumerKey}", oauth_signature="${encodeURIComponent(signature)}", oauth_token="${auth.oauth_token}", oauth_nonce="${nonce}", oauth_signature_method="HMAC-SHA1"`

    return authorization;
}

function randomString(length) {
    let characters = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''

    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length))
    }

    return result;
}

function rfc3986encode(str) {
    return encodeURIComponent(str)
    .replaceAll('!', '%21')
    .replaceAll('*', '%2A')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('\'', '%27');
}

module.exports.init = init;
module.exports.post = post;
module.exports.isEnabled = function() {
    return config.twitter.use;
}