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
// ######################### streamlabs_api_handler.js ################################
// Handles the connection to streamlabs api and puts the messages into the
// twitch alerts channel on the back end
// -------------------------- Creation ----------------------------------------
// Author: Silenus aka twitch.tv/OldDepressedGamer
// GitHub: https://github.com/SilenusTA/streamer
// Date: 14-Jan-2021
// --------------------------- functionality ----------------------------------
// 
// --------------------------- description -------------------------------------
// 
// ----------------------------- notes ----------------------------------------
// TBD. 
// ============================================================================


// ============================================================================
//                           IMPORTS/VARIABLES
// ============================================================================
// Desription: Import/Variable secion
// ----------------------------- notes ----------------------------------------
// We have to iport two versions of socket.io due to streamlabs using an older
// version.
// ============================================================================
// note this has to be socket.io-client version 2.0.3 to allow support for StreamLabs api.
import StreamLabsIo from "socket.io-client_2.0.3";
import * as logger from "../../backend/data_center/modules/logger.js";
import sr_api from "../../backend/data_center/public/streamroller-message-api.cjs"
import * as fs from "fs";
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

let localConfig = {
    ENABLE_STREAMLABS_CONNECTION: true, // disables the socket to streamlabs (testing purposes only)
    OUR_CHANNEL: "STREAMLABS_ALERT",
    EXTENSION_NAME: "streamlabs_api",
    SYSTEM_LOGGING_TAG: "[EXTENSION]",
    heartBeatTimeout: 5000,
    heartBeatHandle: null,
    status: {
        connected: false // this is our connection indicator for discord
    },
    DataCenterSocket: null,
    StreamLabsSocket: null
};

const default_serverConfig = {
    __version__: 0.1,
    extensionname: localConfig.EXTENSION_NAME,
    channel: localConfig.OUR_CHANNEL,
    enabled: "off",
    //credentials variable names to use (in credentials modal)
    credentialscount: "1",
    cred1name: "SL_SOCKET_TOKEN",
    cred1value: "",
};
let serverConfig = structuredClone(default_serverConfig)
// ============================================================================
//                           FUNCTION: start
// ============================================================================
function start (host, port, heartbeat)
{
    logger.extra(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".start", "host", host, "port", port, "heartbeat", heartbeat);
    if (typeof (heartbeat) != "undefined")
        localConfig.heartBeatTimeout = heartbeat;
    else
        logger.err(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".initialise", "DataCenterSocket no heatbeat passed:", heartbeat);
    // ########################## SETUP DATACENTER CONNECTION ###############################
    try
    {
        //use the helper to setup and register our callbacks
        localConfig.DataCenterSocket = sr_api.setupConnection(onDataCenterMessage, onDataCenterConnect, onDataCenterDisconnect, host, port);
    } catch (err)
    {
        logger.err(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.start", "localConfig.DataCenterSocket connection failed:", err);
        throw ("streamlabs_api_handler.js failed to connect to data socket");
    }
}
// ============================================================================
//                           FUNCTION: connectToStreamLabs
// ============================================================================
function connectToStreamLabs (creds)
{
    // ########################## SETUP STREAMLABS CONNECTION ###############################
    // The token can be found at streamlabs.com, its a long hex string under settings->API Tokens->socket API token 
    if (!creds.SL_SOCKET_TOKEN)
        logger.err(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.js", "SL_SOCKET_TOKEN not set");
    else
    {
        try
        {
            if (localConfig.ENABLE_STREAMLABS_CONNECTION)
            {
                localConfig.StreamLabsSocket = StreamLabsIo("https://sockets.streamlabs.com:443?token=" + creds.SL_SOCKET_TOKEN, { transports: ["websocket"] });
                // handlers
                localConfig.StreamLabsSocket.on("connect", (data) => onStreamLabsConnect(data));
                localConfig.StreamLabsSocket.on("disconnect", (reason) => onStreamLabsDisconnect(reason));
                localConfig.StreamLabsSocket.on("event", (data) => onStreamLabsEvent(data));
            }
            else
                logger.warn(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.start", "Streamlabs disabled in config");
            if (localConfig.StreamLabsSocket == "false")
            {
                console.log("connectToStreamLabs: failed to connect")
            }
        } catch (err)
        {
            logger.err(localConfig.SYSTEM_LOGGING_TAG + "connectToStreamLabs", "clientio connection failed:", err);
            throw ("streamlabs_api_handler.js failed to connect to streamlabs");
        }
    }
}
// ########################## STREAMLABS API CONNECTION #######################
// ============================================================================
//                           FUNCTION: onStreamLabsDisconnect
// ============================================================================
function onStreamLabsDisconnect (reason)
{
    localConfig.status.connected = false;
    logger.log(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.onStreamLabsDisconnect", reason);
}
// ============================================================================
//                           FUNCTION: onStreamLabsConnect
// ============================================================================
// Desription: Handles Connect message from the streamlabs api
// Parameters: reason
// ----------------------------- notes ----------------------------------------
// ============================================================================
function onStreamLabsConnect ()
{
    localConfig.status.connected = true;
    // start our heatbeat timer
    logger.log(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.onStreamLabsConnect", "streamlabs api socket connected");
}

// ============================================================================
//                           FUNCTION: onStreamLabsEvent
// ============================================================================
// Desription: Handles messaged from the streamlabs api
// Parameters: reason
// ----------------------------- notes ----------------------------------------
// ============================================================================
function onStreamLabsEvent (data)
{
    logger.info(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.onStreamLabsEvent", "received message: ", data);
    // Send this data to the channel for this
    if (serverConfig.enabled === "on")
        sr_api.sendMessage(localConfig.DataCenterSocket,
            sr_api.ServerPacket(
                "ChannelData",
                localConfig.EXTENSION_NAME,
                data,
                localConfig.OUR_CHANNEL
            ));
}
// ########################## DATACENTER CONNECTION #######################
// ============================================================================
//                           FUNCTION: onDataCenterDisconnect
// ============================================================================
// Desription: Handles Disconnect message from the datacenter
// Parameters: reason
// ----------------------------- notes ----------------------------------------
// ============================================================================
function onDataCenterDisconnect (reason)
{
    logger.log(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.onDataCenterDisconnect", reason);
}
// ============================================================================
//                           FUNCTION: onDataCenterConnect
// ============================================================================
// Desription: Handles Connect message from the datacenter
// Parameters: reason
// ----------------------------- notes ----------------------------------------
// ============================================================================
function onDataCenterConnect ()
{
    //store our Id for futre reference
    logger.log(localConfig.SYSTEM_LOGGING_TAG + "streamlabs_api_handler.onDataCenterConnect", "Creating our channel");
    //register our channels
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("CreateChannel", localConfig.EXTENSION_NAME, localConfig.OUR_CHANNEL));
    // Request our config from the server
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("RequestConfig", localConfig.EXTENSION_NAME));
    // Request our credentials from the server
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("RequestCredentials", serverConfig.extensionname));
    // clear the previous timeout if we have one
    clearTimeout(localConfig.heartBeatHandle);
    // start our heatbeat timer
    localConfig.heartBeatHandle = setTimeout(heartBeatCallback, localConfig.heartBeatTimeout)
}
// ============================================================================
//                           FUNCTION: onDataCenterMessage
// ============================================================================
// Desription: Handles messages from the datacenter
// Parameters: reason
// ----------------------------- notes ----------------------------------------
// ============================================================================
function onDataCenterMessage (server_packet)
{
    if (server_packet.type === "ConfigFile")
    {

        // check it is our config
        if (server_packet.to === serverConfig.extensionname && server_packet.data != "")
        {
            if (server_packet.data.__version__ != default_serverConfig.__version__)
            {
                serverConfig = structuredClone(default_serverConfig);
                console.log("\x1b[31m" + serverConfig.extensionname + " ConfigFile Updated", "The config file has been Updated to the latest version v" + default_serverConfig.__version__ + ". Your settings may have changed" + "\x1b[0m");
            }
            else
                serverConfig = structuredClone(server_packet.data);

            SaveConfigToServer();
        }
    }
    else if (server_packet.type === "CredentialsFile")
    {
        if (server_packet.to === serverConfig.extensionname && server_packet.data != "")
            connectToStreamLabs(server_packet.data);
        else
        {
            logger.warn(localConfig.SYSTEM_LOGGING_TAG + serverConfig.extensionname + ".onDataCenterMessage",
                serverConfig.extensionname + " CredentialsFile", "Credential file is empty make sure to set it on the admin page.");
        }

    }
    else if (server_packet.type === "ExtensionMessage")
    {
        let extension_packet = server_packet.data;
        // received a reqest for our admin bootstrap modal code
        if (extension_packet.type === "RequestSettingsWidgetSmallCode")
            SendSettingsWidgetSmall(extension_packet.from);
        else if (extension_packet.type === "RequestCredentialsModalsCode")
            SendCredentialsModal(extension_packet.from);
        // received data from our settings widget small. A user has requested some settings be changedd
        else if (extension_packet.type === "SettingsWidgetSmallData")
        {
            if (extension_packet.to === serverConfig.extensionname)
            {
                // lets reset our config checkbox settings (modal will omit ones not checked)
                serverConfig.enabled = "off";
                // set our config values to the ones in message
                for (const [key, value] of Object.entries(serverConfig))
                    if (key in extension_packet.data)
                        serverConfig[key] = extension_packet.data[key];
                // save our data to the server for next time we run
                SaveConfigToServer();
                // broadcast our modal out so anyone showing it can update it
                SendSettingsWidgetSmall("");
            }
        }

    }
    else if (server_packet.type === "UnknownChannel")
    {
        logger.info(localConfig.SYSTEM_LOGGING_TAG + localConfig.EXTENSION_NAME + ".onDataCenterMessage",
            "Channel " + server_packet.data + " doesn't exist, scheduling rejoin");
        //channel might not exist yet, extension might still be starting up so lets rescehuled the join attempt
        // need to add some sort of flood control here so we are only attempting to join one at a time
        if (server_packet.data === serverConfig.channel)
        {
            setTimeout(() =>
            {
                sr_api.sendMessage(localConfig.DataCenterSocket,
                    sr_api.ServerPacket("CreateChannel",
                        localConfig.EXTENSION_NAME,
                        server_packet.data));
            }, 5000);
        }
        else
        {
            setTimeout(() =>
            {
                sr_api.sendMessage(localConfig.DataCenterSocket,
                    sr_api.ServerPacket("JoinChannel",
                        localConfig.EXTENSION_NAME,
                        server_packet.data));
            }, 5000);
        }
    }
    else if (server_packet.type === "ChannelJoined"
        || server_packet.type === "ChannelCreated"
        || server_packet.type === "ChannelLeft"
        || server_packet.type === "LoggingLevel"
        || server_packet.type === "ChannelData")
    {
        // just a blank handler for items we are not using to avoid message from the catchall
    }
    // ------------------------------------------------ unknown message type received -----------------------------------------------
    else
        logger.warn(localConfig.SYSTEM_LOGGING_TAG + localConfig.EXTENSION_NAME +
            ".onDataCenterMessage", "Unhandled message type", server_packet.type);
}
// ============================================================================
//                           FUNCTION: SendSettingsWidgetSmall
// ============================================================================
// Desription: Send the modal code back after setting the defaults according 
// to our server settings
// Parameters: channel to send data to
// ----------------------------- notes ----------------------------------------
// none
// ===========================================================================
function SendSettingsWidgetSmall (toextension)
{
    fs.readFile(__dirname + '/streamlabs_apisettingswidgetsmall.html', function (err, filedata)
    {
        if (err)
            logger.err(localConfig.SYSTEM_LOGGING_TAG + localConfig.EXTENSION_NAME +
                ".SendSettingsWidgetSmall", "failed to load modal", err);
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
                //value is a string then we need to replace the text
                else if (typeof (value) == "string")
                    modalstring = modalstring.replace(key + "text", value);
            }
            // send the modal data to the server
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket(
                    "ExtensionMessage",
                    localConfig.EXTENSION_NAME,
                    sr_api.ExtensionPacket(
                        "SettingsWidgetSmallCode",
                        localConfig.EXTENSION_NAME,
                        modalstring,
                        "",
                        toextension
                    ),
                    "",
                    toextension
                ));
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

    fs.readFile(__dirname + "/streamlabs_apicredentialsmodal.html", function (err, filedata)
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
                {
                    modalstring = modalstring.replace(key + "checked", "checked");
                }   //value is a string then we need to replace the text
                else if (typeof (value) == "string")
                {
                    modalstring = modalstring.replace(key + "text", value);
                }
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
// Desription:save config on backend data store
// Parameters: none
// ----------------------------- notes ----------------------------------------
// none
// ===========================================================================
function SaveConfigToServer ()
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket(
            "SaveConfig",
            localConfig.EXTENSION_NAME,
            serverConfig
        ));
}

// ============================================================================
//                           FUNCTION: heartBeat
// ============================================================================
function heartBeatCallback ()
{
    let connected = localConfig.status.connected
    if (serverConfig.enabled === "off")
        connected = false;
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("ChannelData",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "HeartBeat",
                serverConfig.extensionname,
                { connected: connected },
                serverConfig.channel),
            serverConfig.channel
        ),
    );
    localConfig.heartBeatHandle = setTimeout(heartBeatCallback, localConfig.heartBeatTimeout)
}
// ============================================================================
//                           EXPORTS: start
// ============================================================================
// Desription: exports from this module
// ----------------------------- notes ----------------------------------------
// ============================================================================
export { start };
