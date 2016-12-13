export const slackConfig = {
    botToken: process.env.SLACK_BOT_TOKEN,
    adminToken: process.env.SLACK_ADMIN_TOKEN,
};

export const discordConfig = {
    token: process.env.DISCORD_TOKEN
}

function checkConfig(obj) {
    Object.keys(obj).forEach((key) => {
        if(!obj[key]){
            throw 'Invalid configuration';
        }
    });
}

[slackConfig, discordConfig].forEach(checkConfig);
