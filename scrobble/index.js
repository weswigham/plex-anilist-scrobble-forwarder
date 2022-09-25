// @ts-check

import * as process from "process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parseMultipartFormData = require("@anzp/azure-function-multipart").default;

const ANILIST_CLIENT_ID = process.env.ANILIST_CLIENT_ID;
const ANILIST_CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET;

/**
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
 * @param {string} query
 * @param {Record<string, any>} variables
 * @param {string} auth
 */
async function anilistGraphQLFetch(context, query, variables, auth) {
    return (await fetchAndLogOnError(context, "https://graphql.anilist.co", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${auth}`,
        },
        body: JSON.stringify({
            query,
            variables
        }),
    })).json();
}

/**
 * @param {import("@azure/functions").Context} context
 * @param {import("@azure/functions").HttpRequest} req
 */
export default async function (context, req) {
    context.log(`${req.method} ${req.url}`);
    context.log(req.query);
    context.log(req.params);
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

            context.log("Successfully got anilist access token:");
            context.log(token);

            const webhookURL = new URL(req.url);
            webhookURL.search = "";
            webhookURL.hash = "";
            webhookURL.search = `?token=${token}`;
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
    else if (req.method === "POST" && req.query.token) {
        const { fields } = await parseMultipartFormData(req);
        const data = JSON.parse(fields[0].value);
        context.log(data);
        // data.user is set for requests where the scrobble is for the webhook's intended
        // user. Events also get sent for any media on servers the user _owns_ with owner:
        // true (and user: false if they're not the watcher).
        if (data.event === "media.scrobble" && data.user) {
            // The following match essentially requires using the hama agent and prefering anidb matches (tvdb matches will fail to sync)
            const anidbMatch = /com\.plexapp\.agents\.hama\:\/\/anidb-(\d+?)\//.exec(data.Metadata.guid);
            if (anidbMatch) {
                const anidbId = Number(anidbMatch[1]);
                // Now, anidb IDs aren't anilist IDs, so we have to map them
                // We graciously use https://github.com/BeeeQueue/arm-server 's open API to map the IDs
                // Because running the API ourselves would be waaaaaaay mor effort than I'm willing to put in for
                // an afternoon's hack.
                // In theory, we should somehow cache the results locally to be a better citizen and reduce traffic
                // to the API. But that's also effort, so I'm just hoping there's a CDN in front of the API if it
                // starts to matter.
                const ids = await (await fetch(`https://arm.haglund.dev/api/ids?source=anidb&id=${anidbId}`)).json();

                const anilistId = ids.anilist;
                const season = data.Metadata.parentIndex;
                const episode = data.Metadata.index;

                const response = anilistGraphQLFetch(context, `query {
    AniChartUser {
        user {
            id,
            name
        }
    }
}`, {}, req.query.token);

                context.log(response);
                // TODO: Fetch watch state from anilist to make sure it's not newer, then submit a new watch state

                // BLOCKED: The auth token/code from anilist is 1159/890 characters long. This makes the URL exceed PLEX's
                // silent webhook URL length limit of 512. See https://forums.plex.tv/t/bug-webhook-urls-are-capped-at-512-characters
                // To work around that limitation, this function app needs to actually _store things_. Terrible, I know.
                // That also opens up a bigger desire for proper auth, to ensure stored data doesn't inappropriately leak.
                // Given all that, this goes from "simple afternoon 250 line script" to "massive undertaking" real quick.
                // Maybe I'll come back to this when I have a hankering to figure out azure tables and azure managed identity...
                // Hah.

                context.res = {
                    status: "200",
                };
                return;
            }
        }
    }

    context.res = {
        status: "404",
    };
    return;
}
