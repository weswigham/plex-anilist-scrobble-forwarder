// @ts-check

import * as process from "process";

const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID;
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET;

/**
 * @param {import("@azure/functions").Context} context
 * @param {import("@azure/functions").HttpRequest} req
 */
export default async function (context, req) {
    if (req.method === "GET") {
        if (!req.params.code) {
            context.res = {
                status: "200",
                body: `
<html>
    <head>
        <title>Auth To Anilist</title>
    </head>
    <body>
        <a href='https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&redirect_uri=${encodeURI(req.url)}&response_type=code'>Login with AniList</a>
    </body>
</html>
`
            };
            return;
        }
        else {
            const webhookURL = new URL(req.url);
            webhookURL.search = "";
            webhookURL.hash = "";
            webhookURL.search = `?code=${req.params.code}`;
            context.res = {
                status: "200",
                body: `
<html>
    <head>
        <title>Your Webhook URL</title>
    </head>
    <body>
        Your authenticated webhook URL is
        
        <pre><code>
            ${webhookURL.toString()}
        </code></pre>

        Treat this as you would your anilist password.

        Paste this URL into your PLEX account's "Webhooks" panel.
    </body>
</html>
`
            };
            return;
        }
    }
    else if (req.method === "POST" && req.params.code) {
        const redirectUri = new URL(req.url);
        redirectUri.search = "";
        redirectUri.hash = "";
        const res =  await fetch("https://anilist.co/api/v2/oauth/token", {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                'grant_type': 'authorization_code',
                'client_id': ANILIST_CLIENT_ID,
                'client_secret': ANILIST_CLIENT_SECRET,
                'redirect_uri': redirectUri,
                'code': req.params.code,
            }),
        });
        if (res.status !== 200) {
            context.res = {
                status: "401",
            };
            return;
        }
        const json = await res.json();
        const token = json.access_token;
        // TODO: GraphQL it up and use the `media.scrobble` event in the request to set the corresponding episode in anilist "played"
        console.log("Successfully got anilist access token:");
        console.log(token);
        console.log("PLEX webhook request body:");
        console.log(req.body);
        return;
    }

    context.res = {
        status: "404",
    };
    return;
}
