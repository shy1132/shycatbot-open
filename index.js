//shycatbot
//aka the 9,000th automated image tweeter

//requires
const { TwitterApi } = require('twitter-api-v2')
const mime = require('mime-types')
const fs = require('fs').promises
const path = require('path')
const config = require('./config.json')

//code
if(!config.twitterAuth.appKey) return console.log('missing twitter keys');

const client = new TwitterApi({
    appKey: config.twitterAuth.appKey,
    appSecret: config.twitterAuth.appSecret,
    accessToken: config.twitterAuth.accessToken,
    accessSecret: config.twitterAuth.accessSecret,
    timeout_ms: 60 * 1000,
    strictSSL: true
})

async function tweetRandomFile() {
    var files = await fs.readdir(config.directory)

    var fileName = files[Math.floor(Math.random() * files.length)]
    var filePath = path.join(config.directory, fileName)
    var fileExtension = path.parse(fileName).ext?.toLowerCase()
    if(!fileExtension) return console.log(`${fileName} doesn't have an extension`);

    console.log(`tweeting ${fileName}`)

    var mimeType = mime.lookup(fileExtension)
    if(!config.acceptableMimeTypes.includes(mimeType)) return console.log(`${fileName} is not an acceptable file type`);

    try {
        var media = await client.v1.uploadMedia(filePath)
        await client.v2.tweet(fileName, { media: { media_ids: [ media ] } })
    } catch (err) {
        console.log(`failed to tweet ${fileName}`)
        console.error(err)
    }
}

tweetRandomFile()
setInterval(tweetRandomFile, config.tweetIntervalMs)