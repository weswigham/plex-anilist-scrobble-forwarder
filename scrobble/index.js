// @ts-check

import * as process from "process";
import { isContext } from "vm";

const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID;
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET;

/**
 * @param {*} req 
 * @returns {object | undefined}
 */
function tryGetJSONBody(req) {
    try {
        return JSON.parse(req.body.toString());
    }
    catch (_) {
        return undefined;
    }
}

/**
 * 
 * @param {import("@azure/functions").Context} context 
 * @param {string} url 
 * @param {Parameters<typeof fetch>[1]=} options 
 * @returns {ReturnType<typeof fetch>}
 */
async function fetchAndLogOnError(context, url, options) {
    try {
        return await fetch(url, options);
    }
    catch (err) {
        context.log(err);
        throw err;
    }
}

/**
 * @param {import("@azure/functions").Context} context
 * @param {import("@azure/functions").HttpRequest} req
 */
export default async function (context, req) {
    context.log(`${req.method} ${req.url}`);
    context.log(req.query);
    context.log(req.params);
    context.log(req.body.toString());
    if (req.method === "GET") {
        if (!req.query.code) {
            context.res = {
                status: "200",
                headers: {
                    "Content-Type": "text/html; charset=UTF-8",
                },
                body: `
<html>
    <head>
        <title>Auth To Anilist</title>
    </head>
    <body>
        <a href="https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&redirect_uri=${encodeURIComponent(req.url)}&response_type=code">Login with AniList</a>
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
            webhookURL.search = `?code=${req.query.code}`;
            context.res = {
                status: "200",
                headers: {
                    "Content-Type": "text/html; charset=UTF-8",
                },
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
    else if (req.method === "POST" && req.query.code) {
        const redirectUri = new URL(req.url);
        redirectUri.search = "";
        redirectUri.hash = "";
        const res = await fetchAndLogOnError(context, "https://anilist.co/api/v2/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                "grant_type": "authorization_code",
                "client_id": ANILIST_CLIENT_ID,
                "client_secret": ANILIST_CLIENT_SECRET,
                "redirect_uri": redirectUri,
                "code": req.query.code,
            }),
        });
        if (res.status !== 200) {
            context.log(await res.text());
            context.res = {
                status: "401",
            };
            return;
        }
        const json = await res.json();
        const token = json.access_token;
        // TODO: GraphQL it up and use the `media.scrobble` event in the request to set the corresponding episode in anilist "played"
        context.log("Successfully got anilist access token:");
        context.log(token);
        return;
    }

    context.res = {
        status: "404",
    };
    return;
}
