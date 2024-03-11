//shycatbot
//aka the 9,001st automated image tweeter

//requires
const fs = require('fs').promises
const path = require('path')
const mime = require('mime-types')
const config = require('./config.json')

//code
let platforms = {
    twitter: require('./services/twitter.js'),
    bluesky: require('./services/bluesky.js'),
    threads: require('./services/threads.js'),
    instagram: require('./services/instagram.js'),
    tumblr: require('./services/tumblr.js'),
    mastodon: require('./services/mastodon.js'),
    cohost: require('./services/cohost.js'),
    firefish: require('./services/firefish.js')
}

let platformKeys = Object.keys(platforms);
platformKeys = platformKeys.reverse()
platformKeys = platformKeys.sort((a, b) => {
    let indexA = config.priorityList.indexOf(a)
    let indexB = config.priorityList.indexOf(b)

    if (indexA === -1 && indexB === -1) { //if both not in priority list, keep original order
      return 0;
    }

    if (indexA === -1) { //if element not in priority list, move it to the end
        return 1;
    }

    if (indexB === -1) { //same deal
        return -1;
    }

    return indexA - indexB;
})

let usedPlatforms = [];
let doneCount = 0;

function logSegment() {
    return console.log('-'.repeat(64));
}

async function initialize() {
    console.log('initializing')

    if (config.syncPosts) {
        console.log('sync posts is on; compatible media types are limited to only ones all used platforms support, which removes a lot of potential for posts')

        let configs = platformKeys.map((platform) => config[platform])
        let allMimeTypes = configs.filter(config => config.use && config.mimeTypes).map(config => config.mimeTypes)
        let commonMimeTypes = allMimeTypes[0].filter((value) => allMimeTypes.every((array) => array.includes(value)))

        config.mimeTypes = commonMimeTypes;
    } else {
        console.log('sync posts is off; if the bot tries to post media that isn\'t supported on a platform, it will choose a different file for that platform')
    }

    for (let platform of platformKeys) {
        if (config[platform].use) {
            let response;
            try {
                response = await platforms[platform].init()
            } catch {
                console.log(`uncaught error occurred while initializing ${platform}, disabling`)
                response = false;
            }

            if (response === false) {
                config[platform].use = false;
            } else {
                usedPlatforms.push(platform)
            }
        }
    }

    if (usedPlatforms.length < 1) return console.log('u have no platforms enabled or they all failed')

    logSegment()

    postRandomFile()
    setInterval(postRandomFile, config.postIntervalMs)
}

async function postRandomFile() {
    let file = await getRandomFile(config.syncPosts ? config.mimeTypes : null);
    console.log(`posting ${file.fileName}`)

    for (let platform of platformKeys) { //a bit hard to read but its dynamic so i wont really ever have to change this
        let platformConfig = config[platform]
        if (platformConfig.use) platformConfig.use = platforms[platform].isEnabled();
        if (!platformConfig.use) continue;

        if (platformConfig.mimeTypes && !platformConfig.mimeTypes.includes(file.mimeType) && !config.syncPosts) {
            console.log(`${platform}: ${file.mimeType} unsuitable, picking different file for ${platform}`)

            let differentFile = await getRandomFile(platformConfig.mimeTypes);
            console.log(`${platform}: posting ${differentFile.fileName}`)

            platforms[platform].post(differentFile.fileName, differentFile.filePath, differentFile.mimeType)
        } else {
            console.log(`${platform}: posting ${file.fileName}`)
            platforms[platform].post(file.fileName, file.filePath, file.mimeType)
        }

        platforms[platform].onDone(() => doneCount += 1)
    }

    await waitUntilDone();
    logSegment()
}

async function getRandomFile(mimeTypes) {
    let files = await fs.readdir(config.directory)
    if (mimeTypes) files = files.filter(name => mimeTypes.includes(mime.lookup(name))) //remove all mime types that arent in mimeTypes (if mimeTypes is supplied)
    if (files.length < 1) {
        console.log(`no files fitting these mime types could be found: ${mimeTypes.join(', ')}`)
        return { error: true };
    }

    let fileName = files[Math.floor(Math.random() * files.length)]
    let filePath = path.join(config.directory, fileName)
    let fileExtension = path.parse(fileName).ext?.toLowerCase()
    if (!fileExtension) return getRandomFile(mimeTypes);

    let mimeType = mime.lookup(fileExtension)

    return { fileName, filePath, mimeType };
}

function waitUntilDone() {
    return new Promise(resolve => {
        function checkIfDone() {
            if (doneCount === usedPlatforms.length) {
                resolve()
                doneCount = 0;
            } else {
                setTimeout(checkIfDone, 10)
            }
        }

        checkIfDone()
    })
}

initialize()