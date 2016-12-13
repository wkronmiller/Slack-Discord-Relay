import Discord from 'discord.js';
import {slackConfig, discordConfig} from './config';
import {WCWrapper, bindChannels} from './slackHelper';

const slackPrefix = 'dc';

const slack = new WCWrapper(slackConfig.adminToken, slackConfig.botToken);

// Slack id to channel name
var slackChannelMap = {};
// Discord channel name to channel object
var discordChannelMap = {};

const discordBot = new Discord.Client();
discordBot.login(discordConfig.token);

discordBot.on('ready', () => {
    discordBot.channels
        .filter(({type}) => type === 'text' || type === 'dm')
        .forEach((channel) => {
        const channelName = channel.name || channel.recipient.username.replace(/ /g, '-');
        console.log(channelName);
        discordChannelMap[channelName] = channel;
    });
});

discordBot.on('message', ({
    channel, 
    id, 
    content, 
    author: {username: authorName, id: authorId} 
}) => {
    if(authorId === discordBot.user.id) {
        return;
    }
    const discordName = (()=>{
        if(channel.type === 'dm'){
            return authorName.replace(/ /g, '-');
        }
        return channel.name;
    })();
    slack.mkOrGetChannel(`${slackPrefix}-${discordName}`, true).then(({id, name}) => {
        return slack.joinChannel(id, name);
    })
    .catch(console.error)
    .then(({channelId, channelName}) => {
        slackChannelMap[channelId] = channelName;
        return slack.sendMessage({
            channel: channelId,
            text: content,
            username: authorName,
            unfurl_links: true,
        });
    })
    .catch(console.error);
});

discordBot.on('disconnect', (message, code) => {
    throw `Discord disconnected:\n\t${code}\n\t${message}`;
});

console.log('Binding to channels');
bindChannels(slack, slackPrefix)
.then((channels) => {
    slackChannelMap = channels;
    slack.setupRTM(({channel, user, text, attachments}) => {
        const channelName = slackChannelMap[channel];
        if(!channelName){
            return console.log('Unrecognized channel', channel, user, text);
        }
        if(!user) {
            return;
        }
        const discordName = channelName.replace(`${slackPrefix}-`, '');
        const discordChannel = discordChannelMap[discordName];
        if(!discordChannel){
            return console.error('No channel found for', channelName, discordName);
        } 
        discordChannel.sendMessage(text).catch(console.error);
    });
});
