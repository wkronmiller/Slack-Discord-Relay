import Discord from 'discord.io';
import request from 'request';
import {RtmClient, CLIENT_EVENTS, RTM_EVENTS} from '@slack/client';
import redis from 'redis';

const discord_bot_name = process.env.DISCORD_BOT_NAME;
const discord_channel = process.env.DISCORD_CHANNEL_ID;
if(!discord_channel){
    throw 'Discord channel not set';
}
const slack_channel = process.env.SLACK_CHANNEL_ID;
if(!slack_channel){
    throw 'Slack channel not set';
}
const slack_url = process.env.SLACK_HOOK_URL;
if(!slack_url){
    throw 'Need to specify slack webhook url';
}
const slack_user = process.env.SLACK_USER;

const redis_set_name = `discord:${discord_channel}`; 
const redisClient = redis.createClient({host: 'redis'});

const rtm = new RtmClient(process.env.SLACK_TOKEN);
rtm.start();

rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, () => {
    console.log('Slack started');
    reconnectDiscord();
});

const slack_bot_name = 'slackbot';

rtm.on(RTM_EVENTS.MESSAGE, (message) => {
    if(message.channel != slack_channel || message.user != slack_user){
        //console.log('skipping', message, {slack_channel, slack_user});
        return;
    }
    console.log('Sending slack message to discord');
    //TODO: clean message
    if(discord_connected){
        discordBot.sendMessage({to: discord_channel, message: message.text, typing: true}, (err, response) => {
            if(err){
                sendSlack(`Discord error: ${JSON.stringify(err)}`, slack_bot_name);
            }
        });
    }else {
        sendSlack('Discord is not connected', slack_bot_name);
    }
});

function sendSlack(message, name){
    console.log('Sending slack message');
    function postData(body) {
        const options = {
            url: slack_url,
            method: 'POST',
            body: JSON.stringify(body),
        };
        request(options, (err, response, body) => {
            if(err){
                throw err;
            }
            console.log(body);
        });
    }

    postData({text: message, username: name, channel: process.env.SLACK_CHANNEL})
}

var last_message_id = undefined;
var discord_connected = false;

function checkMessage(message){
    return new Promise((resolve, reject) => {
        redisClient.sadd(redis_set_name, message.id, (err, result)=>{
            if(err){
                return reject(err);
            }
            const output = {exists: result == 0, message};
            resolve(output);
        });
    });
}

const discordBot = new Discord.Client({
    token: process.env.DISCORD_TOKEN,
    autorun: false
});

var firstStart = true;
discordBot.on('ready', () => {
    console.log('Discord connected');
    discord_connected = true;
    if(firstStart){
        checkLoop();
        firstStart = false;
    }
});

function checkLoop(){
    getMessages();
    setTimeout(checkLoop, 5000);
}

discordBot.on('message', (_user, _userId, channelId, _message, event) => {
    getMessages();
});

function reconnectDiscord() {
    discordBot.connect();
    setTimeout(reconnectDiscord, 5000);
}

discordBot.on('disconnect', (message, code) => {
    console.log(`Discord disconnected (${code}): ${message}`)
    discord_connected = false;
    //TODO: send slack warning
    reconnectDiscord();
});

function simplifyMessage(message) {
    const {author, id, content} = message;
    const fixedContent = discordBot.fixMessage(content);
    return {id, content: fixedContent, user: author.username};
}

function updateLastMessageId(message) {
    last_message_id = Math.max(last_message_id, message.id);
    return message;
}

function getMessages() {
    new Promise((resolve, reject) => {
        discordBot.getMessages({after: last_message_id - 1, channelID: discord_channel}, (err, messages) => {
            if(err){
                return reject(err);
            }
            return resolve(messages);
        });
    })
    .then((messages) => messages.map(simplifyMessage))
    .then((messages) => messages.map(updateLastMessageId))
    .then((messages) => Promise.all(messages.map(checkMessage)))
    .then((messages) => messages.filter((message) => message.exists == false))
    .then((messages) => messages.map(({message}) => message))
    .then((messages) => messages.filter(({user}) => user != discord_bot_name))
    .then((messages) => messages.forEach((message) => {
        console.log('adding discord message');
        sendSlack(message.content, message.user)
    }))
}
