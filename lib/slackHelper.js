import winston from 'winston';
import {WebClient, RtmClient, RTM_EVENTS} from '@slack/client';
/**
 * Wrapper around Slack webclient
 */
export class WCWrapper {
    constructor(adminToken, botToken) {
        this.adminClient = new WebClient(adminToken);
        this.botClient = new WebClient(botToken);
        this.botRTM = new RtmClient(botToken);
        
        var that = this;
        this.botClient.auth.test().then(({user_id}) => {
            that.botId = user_id;
        });
    }
    setupRTM(messageCallback) {
        this.botRTM.on(RTM_EVENTS.MESSAGE, messageCallback);
        this.botRTM.start();
    }
    getChannelInfo(channelName){
        function handleResult(res) {
            const {ok, channels, groups} = res;
            if(!ok){
                throw 'Unknown web client error';
            }
            const matchingChannels = (channels || groups)
                .filter((channel) => channel.name === channelName || channel.id === channelName);
            if(matchingChannels.length === 1){
                return matchingChannels[0];
            }
            return null;
        }
        const chanPromise = this.botClient.channels.list().then(handleResult);
        const groupPromise = this.adminClient.groups.list().then(handleResult);
        return Promise.all([chanPromise, groupPromise]).then((chanList) => {
            const matches = chanList.filter((chan) => chan);
            if(matches.length === 1) {
                return matches[0];
            } else if(matches.length === 0) {
                return null;
            }
            winston.error('Multiple matching channels', {matches});
            return matches;
        });
    }
    getChannelsWithPrefix(prefix){
        function filterName({name}) {
            return name.lastIndexOf(prefix) === 0;
        }
        const channelsPromise = this.botClient.channels.list().then(({channels}) => {
            return channels.filter(filterName);
        });
        const groupsPromise = this.adminClient.groups.list().then(({groups}) => {
            return groups.filter(filterName);
        });
        return Promise.all([channelsPromise, groupsPromise])
            .then((lists) => lists[0].concat(lists[1]))
            .then((list) => {
                winston.debug('chanlist', list);
                return list;
            });
    }
    mkChannel(channelName, mkPrivate){
        function handleResult(res) {
            const {ok, channel, group, error} = res;
            if(!ok) {
                throw {ok, error};
            }
            return channel || group;
        }
        return this.getChannelInfo(channelName).then((chanInfo) => {
            if(chanInfo) {
                if(chanInfo.is_archived) {
                    chanInfo.is_archived = false;
                    return this.adminClient.groups.unarchive(chanInfo.id).then(() => chanInfo);
                }
                return Promise.resolve(chanInfo);
            }
            if(mkPrivate) {
                return this.adminClient.groups.create(channelName).then(handleResult);
            }
            return this.adminClient.channels.create(channelName).then(handleResult);
        });
    }
    joinChannel(channelId, channelName) {
        return this._joinChannel(channelId).then(() => {
            return {channelId, channelName};
        });
    }
    _getBotId() {
        return this.botClient.auth.test().then(({user_id}) => user_id);
    }
    _joinChannel(channelId){
        return this._getBotId().then((userId) => {
            return this.getChannelInfo(channelId).then((channel) => {
                winston.debug('joining channel', channel);
                return {userId, members: channel.members, group: channel.is_group};
            }).catch((error) => winston.error('Chan lookup error', {error, channelId}));
        })
        .then(({userId, members, group}) => {
            if(members.indexOf(userId) !== -1) {
                return null;
            }
            return {userId, group};
        })
        .then((channel) => {
            if(channel){
                const {userId, group} = channel;
                if(group) {
                    return this.adminClient.groups.invite(channelId, userId).then(() => channelId);
                }
                return this.adminClient.channels.invite(channelId, userId).then(() => channelId);
            }
            return Promise.resolve(channelId);
        });
    }
    mkOrGetChannel(channelName, makePrivate){
        return this.getChannelInfo(channelName).then((channelInfo) => {
            if(channelInfo && channelInfo.is_archived === false) {
                return channelInfo;
            }
            return this.mkChannel(channelName, makePrivate);
        });
    }
    sendMessage(options){
        const {channel, text} = options;
        return this.botClient.chat.postMessage(channel, text, options);
    }
}

/**
 * Join and map to channels with prefix
 */
export function bindChannels(slack, prefix) {
    return slack.getChannelsWithPrefix(prefix).then((channels) => {
        winston.debug('Got channels', channels);
        return Promise.all(channels.filter(({is_archived}) => !is_archived).map(({id, name}) => slack.joinChannel(id, name)));
    })
    .then((channels) => {
        winston.debug('Joined channels');
        return channels.reduce((obj, {channelId, channelName}) => {
            obj[channelId] = channelName;
            return obj;
        }, {});
    });
}
