/**
 *      StreamRoller Copyright 2023 "SilenusTA https://www.twitch.tv/olddepressedgamer"
 * 
 *      StreamRoller is an all in one streaming solution designed to give a single
 *      'second monitor' control page and allow easy integration for configuring
 *      content (ie. tweets linked to chat, overlays triggered by messages, hue lights
 *      controlled by donations etc)
 * 
 *      This program is free software: you can redistribute it and/or modify
 *      it under the terms of the GNU Affero General Public License as published
 *      by the Free Software Foundation, either version 3 of the License, or
 *      (at your option) any later version.
 * 
 *      This program is distributed in the hope that it will be useful,
 *      but WITHOUT ANY WARRANTY; without even the implied warranty of
 *      MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *      GNU Affero General Public License for more details.
 * 
 *      You should have received a copy of the GNU Affero General Public License
 *      along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// ############################# STREAMERSONGLIST.js ##############################
// Provides streamer songlist functionality
// ---------------------------- creation --------------------------------------
// Author: Silenus aka twitch.tv/OldDepressedGamer
// GitHub: https://github.com/SilenusTA/streamer
// Date: 25-May-2023
// --------------------------- functionality ----------------------------------
// Current functionality:
//
// ----------------------------- notes ----------------------------------------
// ============================================================================

// ============================================================================
//                           IMPORTS/VARIABLES
// ============================================================================
// logger will allow you to log messages in the same format as the system messages
import * as logger from "../../backend/data_center/modules/logger.js";
// extension helper provides some functions to save you having to write them.
import sr_api from "../../backend/data_center/public/streamroller-message-api.cjs";
import fetch from 'node-fetch';
import * as fs from "fs";
import io from 'socket.io-client';
// these lines are a fix so that ES6 has access to dirname etc
import { dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

const localConfig = {
    SYSTEM_LOGGING_TAG: "[EXTENSION]",
    DataCenterSocket: null,
    ssl_client: null,
    status: {
        connected: false,
    },
    pollSongQueueHandle: null,
    pollSongListHandle: null,
    songlist: [],
    currentsong: "",
    username: "",
    clientId: "",
    userId: "",
    streamerId: ""
};
const default_serverConfig = {
    __version__: 0.1,
    extensionname: "streamersonglist",
    channel: "STREAMERSONGLIST_CHANNEL",
    enablestreamersonglist: "off",
    pollSongQueueTimeout: 180000, // check for updated queue every 3 minutes in case the socket goes down
    pollSongListTimeout: 300000, // check for updated songs every 5 minutes in case the socket goes down
    heartBeatTimeout: 5000,
    //credentials variable names to use (in credentials modal)
    credentialscount: "4",
    cred1name: "username",
    cred1value: "",
    cred2name: "clientId",
    cred2value: "",
    cred3name: "userId",
    cred3value: "",
    cred4name: "streamerId",
    cred4value: "",
};
let serverConfig = structuredClone(default_serverConfig);

const SSL_SOCKET_EVENTS = {
    JOIN_ROOM: 'join-room',
    LEAVE_ROOM: 'leave-room',
    NEW_SONG: 'new-song',
    RELOAD_SONG_LIST: 'reload-song-list',
    UPDATE_SONG: 'update-song',
    UPDATE_SONGS: 'update-songs',
    DELETE_SONG: 'delete-song',
    UPDATE_QUEUE_LIST: 'queue-update',
    RELOAD_SAVED_QUEUE_LIST: 'reload-saved-queue',
    QUEUE_MESSAGE: 'queue-event',
    NEW_PLAYHISTORY: 'new-playhistory',
    UPDATE_PLAYHISTORY: 'update-playhistory',
    DELETE_PLAYHISTORY: 'delete-playhistory',
    UPDATE_STREAMER: 'update-streamer',
    UPDATE_ATTRIBUTES: 'update-attributes',
};
// events we want to reload songlist or queue on 
const SSL_RELOAD_EVENTS =
    ['queue-event', 'reload-song-list']

const triggersandactions =
{
    extensionname: serverConfig.extensionname,
    description: "Streamer songlist (SSL) is a tool for streamers to keep track of songs in a queue that viewers requests <a href='https://www.streamersonglist.com/'>SSL Website</a>",
    // these are messages we can sendout that other extensions might want to use to trigger an action
    triggers:
        [
            {
                name: "SSLSongAddedToQueue",
                displaytitle: "Song Added To Queue",
                messagetype: "SSLSongAddedToQueue",
                parameters: { songName: "" }
            }
            ,
            {
                name: "SSLCurrentSongChanged",
                displaytitle: "Current Song Changed",
                messagetype: "SSLCurrentSongChange",
                parameters: { songName: "" }
            }

        ],
    // these are messages we can receive to perform an action
    actions:
        [
            {
                name: "SSLCurrentSongChanged",
                displaytitle: "Add Song To Queue",
                messagetype: "AddSongToQueue",
                parameters: { songName: "" }
            }
            ,
            {
                name: "SSLPlaySong",
                displaytitle: "Mark Song as played",
                messagetype: "MarkSongAsPlayed",
                parameters: { songName: "" }
            }
        ],
}
// ============================================================================
//                           FUNCTION: initialise
// ============================================================================
/**
 * initialise
 * @param {Object} app 
 * @param {String} host 
 * @param {String} port 
 */
function initialise (app, host, port, heartbeat)
{
    localConfig.heartBeatTimeout = heartbeat
    try
    {
        localConfig.DataCenterSocket = sr_api.setupConnection(onDataCenterMessage, onDataCenterConnect, onDataCenterDisconnect, host, port);
    } catch (err)
    {
        logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".initialise", "localConfig.DataCenterSocket connection failed:", err);
    }
}

// ============================================================================
//                           FUNCTION: onDataCenterDisconnect
// ============================================================================
/**
 * Disconnection message sent from the server
 * @param {String} reason 
 */
function onDataCenterDisconnect (reason)
{
    // do something here when disconnt happens if you want to handle them
    logger.log(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterDisconnect", reason);
}
// ============================================================================
//                           FUNCTION: onDataCenterConnect
// ============================================================================
// Desription: Received connect message
// Parameters: socket 
// ----------------------------- notes ----------------------------------------
// When we connect to the StreamRoller server the first time (or if we reconnect)
// we will get this function called.
// it is also a good place to create/join channels we wish to use for data
// monitoring/sending on.
// ===========================================================================
/**
 * Connection message handler
 * @param {*} socket 
 */
function onDataCenterConnect (socket)
{
    // Request our credentials from the server
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("RequestCredentials", serverConfig.extensionname));
    // Request our config from the server
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("RequestConfig", serverConfig.extensionname));
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("CreateChannel", serverConfig.extensionname, serverConfig.channel));
    localConfig.heartBeatHandle = setTimeout(heartBeatCallback, serverConfig.heartBeatTimeout);
}
// ============================================================================
//                           FUNCTION: onDataCenterMessage
// ============================================================================
/**
 * receives message from the socket
 * @param {data} server_packet 
 */
function onDataCenterMessage (server_packet)
{
    if (server_packet.type === "ConfigFile")
    {
        if (server_packet.data != "" && server_packet.to === serverConfig.extensionname)
        {
            logger.info(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage", "Received config");
            if (server_packet.data.__version__ != default_serverConfig.__version__)
            {
                serverConfig = structuredClone(default_serverConfig);
                console.log("\x1b[31m" + serverConfig.extensionname + " ConfigFile Updated", "The config file has been Updated to the latest version v" + default_serverConfig.__version__ + ". Your settings may have changed" + "\x1b[0m");
            }
            else
                serverConfig = structuredClone(server_packet.data);

            pollSongQueueCallback();
            pollSongListCallback();
            SaveConfigToServer();
        }
    }
    else if (server_packet.type === "CredentialsFile")
    {
        if (server_packet.to === serverConfig.extensionname && server_packet.data && server_packet.data != "")
        {
            localConfig.username = server_packet.data.username;
            localConfig.clientId = server_packet.data.clientId;
            localConfig.userId = server_packet.data.userId;
            localConfig.streamerId = server_packet.data.streamerId;
            // now we have our credentials lets join the server for callbacks
            localConfig.ssl_client = io("https://api.streamersonglist.com", {
                transports: ["websocket"],
                reconnection: true,
            });
            localConfig.ssl_client.on('connect', () =>
            {
                // add all our handlers
                for (const [key] of Object.entries(SSL_SOCKET_EVENTS))
                {
                    localConfig.ssl_client.on(SSL_SOCKET_EVENTS[key], (msg) =>
                    {
                        logger.extra(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage", "StreamerSonglist socket callback received ", SSL_SOCKET_EVENTS[key]);
                        if (SSL_RELOAD_EVENTS["QUEUE_MESSAGE"] == key)
                        {
                            console.log(msg)
                            if (msg.added)
                            {
                                sr_api.sendMessage(localConfig.DataCenterSocket,
                                    sr_api.ServerPacket("ChannelData",
                                        serverConfig.extensionname,
                                        sr_api.ExtensionPacket(
                                            "SSLSongAddedToQueue",
                                            serverConfig.extensionname,
                                            { songName: msg.title },
                                            serverConfig.channel),
                                        serverConfig.channel
                                    ),
                                );
                            }
                            fetchSongQueue();

                        }
                        else if (SSL_RELOAD_EVENTS.includes(SSL_SOCKET_EVENTS[key]) && serverConfig.enablestreamersonglist == "on")
                        {
                            //console.log("fetching. ..........");
                            logger.log(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage", "StreamerSonglist socket callback received, updating songs and queue: ", SSL_SOCKET_EVENTS[key]);
                            fetchSongList();
                            fetchSongQueue();
                        }
                    })
                }
            });
            localConfig.ssl_client.emit("join-room", localConfig.streamerId);
        }

        // Join all interfaces, just for the fun of it and testing


        // perform a fetch of the lists in case we get asked for them later
        fetchSongList()
        fetchSongQueue()
        // start our times if we havent alreadly
        pollSongQueueCallback();
        pollSongListCallback();

    }
    else if (server_packet.type === "ExtensionMessage")
    {
        let extension_packet = server_packet.data;
        if (extension_packet.type === "RequestSettingsWidgetSmallCode")
            SendSettingsWidgetSmall(extension_packet.from);
        else if (extension_packet.type === "RequestCredentialsModalsCode")
            SendCredentialsModal(extension_packet.from);
        else if (extension_packet.type === "SettingsWidgetSmallData")
        {
            // if we have enabled/disabled connection
            if (serverConfig.enablestreamersonglist != extension_packet.data.enablestreamersonglist)
            {
                //we are currently enabled so lets stop polling
                if (serverConfig.enablestreamersonglist == "on")
                {
                    serverConfig.enablestreamersonglist = "off";
                    localConfig.status.connected = false;
                    clearTimeout(localConfig.pollSongQueueTimeout)
                }
                //currently disabled so lets start
                else
                {
                    localConfig.status.connected = true;
                    serverConfig.enablestreamersonglist = "on";
                    pollSongQueueCallback();
                    pollSongListCallback();
                }
            }
            if (extension_packet.to === serverConfig.extensionname)
            {
                serverConfig.enablestreamersonglist = "off";
                for (const [key, value] of Object.entries(extension_packet.data))
                    serverConfig[key] = value;
                SaveConfigToServer();
            }
            //update anyone who is showing our code at the moment
            SendSettingsWidgetSmall("");
        }
        else if (extension_packet.type === "RequestQueue")
        {
            localConfig.songlist = sendSongQueue(extension_packet.from);
        }
        else if (extension_packet.type === "RequestSonglist")
        {
            localConfig.songlist = sendSonglist(extension_packet.from);
        }
        else if (extension_packet.type === "AddSongToQueue")
        {
            addSongToQueue(extension_packet.data.songName);
        }
        else if (extension_packet.type === "MarkSongAsPlayed")
        {
            markSongAsPlayed(extension_packet.data.songName);
        }
        else if (extension_packet.type === "RemoveSongFromQueue")
        {
            removeSongFromQueue(extension_packet.data);
        }
        else if (extension_packet.type === "SendTriggerAndActions")
        {
            console.log("ReqestTriggers")
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket("ExtensionMessage",
                    serverConfig.extensionname,
                    sr_api.ExtensionPacket(
                        "TriggerAndActions",
                        serverConfig.extensionname,
                        triggersandactions,
                        "",
                        server_packet.from
                    ),
                    "",
                    server_packet.from
                )
            )
        }
        else
            logger.warn(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage", "received unhandled ExtensionMessage ", server_packet);
    }
    else if (server_packet.type === "UnknownChannel")
    {
        logger.info(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage", "Channel " + server_packet.data + " doesn't exist, scheduling rejoin");
        // channel might not exist yet, extension might still be starting up so lets rescehuled the join attempt
        setTimeout(() =>
        {
            // resent the register command to see if the extension is up and running yet
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket(
                    "JoinChannel", serverConfig.extensionname, server_packet.data
                ));
        }, 5000);

    }
    else if (server_packet.type === "InvalidMessage")
    {
        logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage",
            "InvalidMessage ", server_packet.data.error, server_packet);
    }
    else if (server_packet.type === "ChannelJoined"
        || server_packet.type === "ChannelCreated"
        || server_packet.type === "ChannelLeft"
        || server_packet.type === "LoggingLevel"
        || server_packet.type === "ExtensionMessage"
    )
    {
        // just a blank handler for items we are not using to avoid message from the catchall
    }
    // ------------------------------------------------ unknown message type received -----------------------------------------------
    else
        logger.warn(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname +
            ".onDataCenterMessage", "Unhandled message type", server_packet.type);
}
// ===========================================================================
//                           FUNCTION: SendSettingsWidgetSmall
// ===========================================================================
/**
 * send some modal code to be displayed on the admin page or somewhere else
 * this is done as part of the webpage request for modal message we get from 
 * extension. It is a way of getting some user feedback via submitted forms
 * from a page that supports the modal system
 * @param {String} tochannel 
 */
function SendSettingsWidgetSmall (tochannel)
{
    // read our modal file
    fs.readFile(__dirname + "/streamersonglistsettingswidgetsmall.html", function (err, filedata)
    {
        if (err)
            logger.err(localConfig.SYSTEM_LOGGING_TAG + localConfig.EXTENSION_NAME +
                ".SendSettingsWidgetSmall", "failed to load modal", err);
        //throw err;
        else
        {
            let modalstring = filedata.toString();
            for (const [key, value] of Object.entries(serverConfig))
            {
                if (value === "on")
                    modalstring = modalstring.replace(key + "checked", "checked");
                // replace text strings
                else if (typeof (value) == "string")
                    modalstring = modalstring.replace(key + "text", value);
            }
            // send the modified modal data to the server
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket(
                    "ExtensionMessage", // this type of message is just forwarded on to the extension
                    serverConfig.extensionname,
                    sr_api.ExtensionPacket(
                        "SettingsWidgetSmallCode", // message type
                        serverConfig.extensionname, //our name
                        modalstring,// data
                        "",
                        tochannel,
                        serverConfig.channel
                    ),
                    "",
                    tochannel // in this case we only need the "to" channel as we will send only to the requester
                ))
        }
    });
}
// ===========================================================================
//                           FUNCTION: SendCredentialsModal
// ===========================================================================
/**
 * Send our CredentialsModal to whoever requested it
 * @param {String} extensionname 
 */
function SendCredentialsModal (extensionname)
{

    fs.readFile(__dirname + "/streamersonglistcredentialsmodal.html", function (err, filedata)
    {
        if (err)
            logger.err(localConfig.SYSTEM_LOGGING_TAG + localConfig.EXTENSION_NAME +
                ".SendCredentialsModal", "failed to load modal", err);
        //throw err;
        else
        {
            let modalstring = filedata.toString();
            // first lets update our modal to the current settings
            for (const [key, value] of Object.entries(serverConfig))
            {
                // true values represent a checkbox so replace the "[key]checked" values with checked
                if (value === "on")
                    modalstring = modalstring.replace(key + "checked", "checked");
                else if (typeof (value) == "string" || typeof (value) == "number")
                    modalstring = modalstring.replace(key + "text", value);
            }
            // send the modal data to the server
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket("ExtensionMessage",
                    serverConfig.extensionname,
                    sr_api.ExtensionPacket(
                        "CredentialsModalCode",
                        serverConfig.extensionname,
                        modalstring,
                        "",
                        extensionname,
                        serverConfig.channel
                    ),
                    "",
                    extensionname)
            )
        }
    });
}
// ============================================================================
//                           FUNCTION: SaveConfigToServer
// ============================================================================
/**
 * savel config file to the server
 */
function SaveConfigToServer ()
{
    // saves our serverConfig to the server so we can load it again next time we startup
    sr_api.sendMessage(localConfig.DataCenterSocket, sr_api.ServerPacket(
        "SaveConfig",
        serverConfig.extensionname,
        serverConfig))
}

// ============================================================================
//                      FUNCTION: sendSongQueue
//                        Sends to extension
// ============================================================================
function sendSongQueue (extensionsname)
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket(
            "ExtensionMessage",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "SongQueue",
                serverConfig.extensionname,
                localConfig.songQueue,
                "",
                extensionsname
            ),
            "",
            extensionsname
        ));
}
// ============================================================================
//                     FUNCTION: outputSongQueue
//                      put queue out on channel
// ============================================================================
function outputSongQueue ()
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("ChannelData",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "SongQueue",
                serverConfig.extensionname,
                localConfig.songQueue,
                serverConfig.channel),
            serverConfig.channel
        ),
    );
}
// ============================================================================
//                           FUNCTION: fetchSongQueue
// ============================================================================
function fetchSongQueue ()
{
    fetch(`https://api.streamersonglist.com/v1/streamers/${localConfig.username}/queue`, {
        headers: { 'Client-ID': localConfig.clientId, },
    })
        .then(response =>
        {
            if (!response.ok)
                throw new Error('Request failed with status ' + response.status);
            return response.json();
        })
        .then(data =>
        {

            localConfig.songQueue = data;
            if (localConfig.currentsong != localConfig.songQueue.list[0].song.title)
            {

                localConfig.currentsong = localConfig.songQueue.list[0].song.title
                // if we have only just loaded lets not send any messages
                if (localConfig.currentsong != "")
                    sendCurrentSongChange("")
            }
            outputSongQueue();
            localConfig.status.connected = true;
        })
        .catch(e =>
        {
            localConfig.status.connected = false;
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".fetchSongQueue", "Error getting songs queue", e.message);
        });
}
// ============================================================================
//                       FUNCTION: sendSonglist
//                      send songlist to extension
// ============================================================================
function sendSonglist (extension)
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket(
            "ExtensionMessage",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "SongList",
                serverConfig.extensionname,
                localConfig.songlist,
                "",
                extension
            ),
            "",
            extension
        ));
}
// ============================================================================
//                       FUNCTION: sendCurrentSongChange
//                      send songlist to extension
// ============================================================================
function sendCurrentSongChange (extension)
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket(
            "ExtensionMessage",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "SSLCurrentSongChange",
                serverConfig.extensionname,
                { songName: localConfig.currentsong },
                "",
                extension
            ),
            "",
            extension
        ));
}
// ============================================================================
//                           FUNCTION: outputSongList
// ============================================================================
function outputSongList ()
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("ChannelData",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "SongList",
                serverConfig.extensionname,
                localConfig.songlist,
                serverConfig.channel),
            serverConfig.channel
        ),
    );
}
// ============================================================================
//                           FUNCTION: fetchSongList
// ============================================================================
function fetchSongList ()
{
    fetch(`https://api.streamersonglist.com/v1/streamers/${localConfig.username}/songs`, {
        headers: { 'Client-ID': localConfig.clientId, },
    })
        .then(response =>
        {
            if (!response.ok)
                throw new Error('Request failed with status ' + response.status);
            return response.json();
        })
        .then(data =>
        {
            localConfig.songlist = data;
            outputSongList();
            localConfig.status.connected = true;
        })
        .catch(e =>
        {
            localConfig.status.connected = false;
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".fetchSongList", "Error getting songs queue", e.message);
        });
}
// ============================================================================
//                           FUNCTION: addSongToQueue
// ============================================================================
function addSongToQueue (songId)
{
    fetch(`https://api.streamersonglist.com/v1/streamers/${localConfig.streamerId}/queue/${songId}/request`, {
        method: 'POST',
        headers: {
            "accept": "application/json",
            "Authorization": "Bearer " + localConfig.clientId,
            "origin": "StreamRoller",
            "source": "StreamRoller",
        }
    })
        .then(response =>
        {
            if (!response.ok)
                throw new Error('Request failed with status ' + response.status);
            return response.json();
        })
        .then(data =>
        {
            fetchSongQueue();
            localConfig.status.connected = true;
        })
        .catch(e =>
        {
            localConfig.status.connected = false;
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".addSongToQueue", "Error adding song", e.message);
        });
}

// ============================================================================
//                           FUNCTION: removeSongFromQueue
// ============================================================================
function removeSongFromQueue (queueId)
{
    const url = `https://api.streamersonglist.com/v1/streamers/${localConfig.streamerId}/queue/${queueId}`
    const headers = {
        "accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": "Bearer " + localConfig.clientId,
        "origin": "StreamRoller",
        "queueId": queueId
    };
    fetch(url, { method: 'DELETE', headers: headers })
        .then(response =>
        {
            if (!response.ok)
                throw new Error('Request failed with status ' + response.status);
            return response.json();
        })
        .then(data =>
        {
            fetchSongQueue()
        })
        .catch(e =>
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".removeSongFromQueue", "Error removing song", e.message);
        });
}

// ============================================================================
//                           FUNCTION: markSongAsPlayed
// ============================================================================
function markSongAsPlayed (queueId)
{
    fetch(`https://api.streamersonglist.com/v1/streamers/${localConfig.streamerId}/queue/${queueId}/played`, {
        method: 'POST',
        headers: {
            "accept": "application/json",
            "Authorization": "Bearer " + localConfig.clientId,
            "origin": "StreamRoller"
        }
    })
        .then(response =>
        {
            if (!response.ok)
            {
                throw new Error('Request failed with status ' + response.status);
            }
            return response.json();
        })
        .then(data =>
        {
            fetchSongQueue()
        })
        .catch(e =>
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".markSongAsPlayed", "Error removing song", e.message);
        });
}

// ============================================================================
//                           FUNCTION: saveQueue
// ============================================================================
function saveQueue (queue)
{
    fetch(`https://api.streamersonglist.com/v1/streamers/${localConfig.streamerId}/queue`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Client-ID': localConfig.clientId,
        },
        body: JSON.stringify(queue),
    })
        .then(response =>
        {
            if (!response.ok)
                throw new Error('Request failed with status ' + response.status);
        })
        .catch(e =>
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".saveQueue", "Error saving queue", e.message);
        });
}
// ============================================================================
//                           FUNCTION: pollSongQueueCallback
// ============================================================================
function pollSongQueueCallback ()
{
    if (serverConfig.enablestreamersonglist == "on" && localConfig.username != "" && localConfig.clientId != "")
    {
        try
        {
            fetchSongQueue();
        }
        catch (err)
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".pollSongQueueCallback", "callback failed:", err.message);
        }
    }
    if (localConfig.pollSongQueueHandle)
        clearTimeout(localConfig.pollSongQueueHandle)
    localConfig.pollSongQueueHandle = setTimeout(pollSongQueueCallback, serverConfig.pollSongQueueTimeout)
}
// ============================================================================
//                           FUNCTION: pollSongListCallback
// ============================================================================
function pollSongListCallback ()
{
    if (serverConfig.enablestreamersonglist == "on" && localConfig.username != "" && localConfig.clientId != "")
    {
        try
        {
            fetchSongList()
        }
        catch (err)
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".pollSongListCallback", "callback failed:", err.message);
        }
    }
    if (localConfig.pollSongListHandle)
        clearTimeout(localConfig.pollSongListHandle)
    localConfig.pollSongListHandle = setTimeout(pollSongListCallback, serverConfig.pollSongListTimeout)
}
// ============================================================================
//                           FUNCTION: heartBeat
// ============================================================================
function heartBeatCallback ()
{
    try
    {
        sr_api.sendMessage(localConfig.DataCenterSocket,
            sr_api.ServerPacket("ChannelData",
                serverConfig.extensionname,
                sr_api.ExtensionPacket(
                    "HeartBeat",
                    serverConfig.extensionname,
                    localConfig.status,
                    serverConfig.channel),
                serverConfig.channel
            ),
        );
    }
    catch (err)
    {
        logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".heartBeatCallback", "callback failed:", err.message);
    }
    localConfig.heartBeatHandle = setTimeout(heartBeatCallback, serverConfig.heartBeatTimeout)
}
// ============================================================================
//                                  EXPORTS
// Note that initialise is mandatory to allow the server to start this extension
// ============================================================================
export { initialise };