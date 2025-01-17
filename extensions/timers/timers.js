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
// ############################# Timers.js ##############################
// This extension creates timers for use in the system.
// ---------------------------- creation --------------------------------------
// Author: Silenus aka twitch.tv/OldDepressedGamer
// GitHub: https://github.com/SilenusTA/streamer
// Date: 12-April-2022
// --------------------------- functionality ----------------------------------
// Current functionality:
// Countdown Timers etc
// ============================================================================

// ============================================================================
//                           IMPORTS/VARIABLES
// ============================================================================
// Desription: Import/Variable secion
// ----------------------------- notes ----------------------------------------
// none
// ============================================================================
import * as logger from "../../backend/data_center/modules/logger.js";
import sr_api from "../../backend/data_center/public/streamroller-message-api.cjs";
import * as fs from "fs";
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { clearTimeout } from "timers";
const __dirname = dirname(fileURLToPath(import.meta.url));
const localConfig = {
    DataCenterSocket: null,
};
const default_serverConfig = {
    __version__: 0.1,
    extensionname: "timers",
    channel: "TIMERS",
    // default values for timer modal
    TimerName: "StartCountdownTimer",
    TimerMessage: "Starting in",
    Timeout: "600"
};
let serverConfig = structuredClone(default_serverConfig);
const timer = {
    name: "Timer",
    message: "message",
    timeleft: 0
}
// ============================================================================
//                           FUNCTION: initialise
// ============================================================================
function initialise (app, host, port, heartbeat)
{
    try
    {
        localConfig.DataCenterSocket = sr_api.setupConnection(onDataCenterMessage, onDataCenterConnect,
            onDataCenterDisconnect, host, port);
    } catch (err)
    {
        logger.err("[EXTENSION]" + serverConfig.extensionname + ".initialise", "localConfig.DataCenterSocket connection failed:", err);
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
    logger.log("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterDisconnect", reason);
}
// ============================================================================
//                           FUNCTION: onDataCenterConnect
// ============================================================================
/**
 * Connection message handler
 * @param {*} socket 
 */
function onDataCenterConnect (socket)
{
    logger.log("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterConnect", "Creating our channel");
    // Request our config from the server
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("RequestConfig", serverConfig.extensionname));

    // Create a channel for messages to be sent out on
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket("CreateChannel", serverConfig.extensionname, serverConfig.channel)

    );
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
    logger.log("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterMessage", "message received ", server_packet);
    if (server_packet.type === "ConfigFile")
    {
        if (server_packet.data != "" && server_packet.to === serverConfig.extensionname)
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
    else if (server_packet.type === "ExtensionMessage")
    {
        let decoded_packet = server_packet.data;
        if (decoded_packet.type === "RequestSettingsWidgetSmallCode")
            // TBD maintain list of all extensions that has requested Modals
            SendSettingsWidgetSmall(decoded_packet.from);
        else if (decoded_packet.type === "SettingsWidgetSmallData")
        {
            if (decoded_packet.data.extensionname === serverConfig.extensionname)
            {
                if (localConfig[decoded_packet.data.TimerName] === undefined)
                    localConfig[decoded_packet.data.TimerName] = {};
                localConfig[decoded_packet.data.TimerName].name = decoded_packet.data.TimerName;
                localConfig[decoded_packet.data.TimerName].message = decoded_packet.data.TimerMessage;
                localConfig[decoded_packet.data.TimerName].timeout = decoded_packet.data.Timeout;
                //serverConfig.checkbox = "off";
                for (const [key, value] of Object.entries(decoded_packet.data))
                    serverConfig[key] = value;

                SaveConfigToServer();
                // broadcast our modal out so anyone showing it can update it
                SendSettingsWidgetSmall("");

                // check any timers needed
                CheckTimers(decoded_packet.data.TimerName);
            }
        }
        else if (decoded_packet.type === "StartSomeTimerHere")
        {
            // This is an extension message from the API. not currently used as timers are started from the settins modals
            CheckTimers(decoded_packet.data.TimerName);
        }
        else if (decoded_packet.type === "SettingsWidgetSmallCode")
        {
            // ignore these messages
        }
        else
            logger.warn("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterMessage", "received unhandled ExtensionMessage ", server_packet);

    }
    else if (server_packet.type === "UnknownChannel")
    {
        logger.info("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterMessage", "Channel " + server_packet.data + " doesn't exist, scheduling rejoin");
        // channel might not exist yet, extension might still be starting up so lets rescehuled the join attempt
        setTimeout(() =>
        {
            // resent the register command to see if the extension is up and running yet
            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket(
                    "JoinChannel", serverConfig.extensionname, server_packet.data
                ));
        }, 5000);
    }    // we have received data from a channel we are listening to
    else if (server_packet.type === "ChannelData")
    {
        logger.log("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterMessage", "received message from unhandled channel ", server_packet.dest_channel);
    }
    else if (server_packet.type === "InvalidMessage")
    {
        logger.err("[EXTENSION]" + serverConfig.extensionname + ".onDataCenterMessage",
            "InvalidMessage ", server_packet.data.error, server_packet);
    }
    else if (server_packet.type === "ChannelJoined"
        || server_packet.type === "ChannelCreated"
        || server_packet.type === "ChannelLeft"
        || server_packet.type === "LoggingLevel"
    )
    {
        // just a blank handler for items we are not using to avoid message from the catchall
    }
    // ------------------------------------------------ unknown message type received -----------------------------------------------
    else
        logger.warn("[EXTENSION]" + serverConfig.extensionname +
            ".onDataCenterMessage", "Unhandled message type", server_packet.type);
}

// ===========================================================================
//                           FUNCTION: SendSettingsWidgetSmall
// ===========================================================================
/**
 * send some modal code 
 * @param {String} tochannel 
 */
function SendSettingsWidgetSmall (tochannel)
{

    fs.readFile(__dirname + '/timerssettingswidgetsmall.html', function (err, filedata)
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
                // checkboxes
                if (value === "on")
                    modalstring = modalstring.replace(key + "checked", "checked");
                // replace text strings
                else if (typeof (value) == "string")
                    modalstring = modalstring.replace(key + "text", value);
            }

            sr_api.sendMessage(localConfig.DataCenterSocket,
                sr_api.ServerPacket(
                    "ExtensionMessage",
                    serverConfig.extensionname,
                    sr_api.ExtensionPacket(
                        "SettingsWidgetSmallCode",
                        serverConfig.extensionname,
                        modalstring,
                        "",
                        tochannel,
                        serverConfig.channel
                    ),
                    "",
                    tochannel
                ))
        }
    });
}
// ============================================================================
//                           FUNCTION: SaveConfigToServer
// ============================================================================
function SaveConfigToServer ()
{
    // saves our serverConfig to the server so we can load it again next time we startup
    sr_api.sendMessage(localConfig.DataCenterSocket, sr_api.ServerPacket
        ("SaveConfig",
            serverConfig.extensionname,
            serverConfig))
}
// ============================================================================
//                           FUNCTION: CheckTimers
// ============================================================================
function CheckTimers (timername)
{
    if (localConfig[timername].timeout > 0)
    {
        Timer(timername)
    }

    // setup new timer
}
// ============================================================================
//                           FUNCTION: Timer
// ============================================================================
function Timer (timername)
{
    sendTimerData(timername, localConfig[timername].timeout);
    localConfig[timername].timeout = localConfig[timername].timeout - 1;
    // write the file
    clearTimeout(localConfig[timername].Handle);
    if (localConfig[timername].timeout >= 0)
    {
        let minutes = Math.floor(localConfig[timername].timeout / 60);
        let seconds = localConfig[timername].timeout - (minutes * 60);
        fs.writeFileSync(__dirname + "/timerfiles/" + timername + ".txt", localConfig[timername].message + " " + minutes + ":" + seconds.toString().padStart(2, '0'))
        localConfig[timername].Handle = setTimeout(() =>
        {
            Timer(timername)
        },
            1000
        )
    }
    else
        fs.writeFileSync(__dirname + "/timerfiles/" + timername + ".txt", " ")
}
// ============================================================================
//                           FUNCTION: sendTimerData
// ============================================================================
function sendTimerData (timername, timedata)
{
    sr_api.sendMessage(localConfig.DataCenterSocket,
        sr_api.ServerPacket(
            "ChannelData",
            serverConfig.extensionname,
            sr_api.ExtensionPacket(
                "Timer",
                serverConfig.extensionname,
                {
                    timername: timername,
                    timerdata: timedata
                },
                serverConfig.channel
            ),
            serverConfig.channel
        ));
}
// ============================================================================
//                                  EXPORTS
// Note that initialise is mandatory to allow the server to start this extension
// ============================================================================
export { initialise };
