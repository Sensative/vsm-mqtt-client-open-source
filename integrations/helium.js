const mqtt = require('mqtt')

const printUsageAndExit = (info) => {
    console.log(info);
    process.exit(1);
}

// Try to determine the maximum downlink frame size
/* TODO: Inventory all these for max size and use in below function
const sfToSizeTable = {
"SF12BW125"    : 51,
"SF11BW125"    : 51,
"SF10BW125"    : 51,
"SF9BW125"     : 115,
"SF8BW125"     : 222,
"SF7BW125"     : 222,
"SF12BW250"    : 
"SF11BW250"    : 
"SF10BW250"    : 
"SF9BW250"     : 
"SF8BW250"     : 
"SF7BW250"     : 
"SF12BW500"    : 
"SF11BW500"    : 
"SF10BW500"    : 
"SF9BW500"     : 
"SF8BW500"     : 
"SF7BW500"     : 
"LRFHSS1BW137" : 7),
"LRFHSS2BW137" : 7),
"LRFHSS1BW336" : 6),
"LRFHSS2BW336" : 6),
"LRFHSS1BW1523": 523),
"LRFHSS2BW1523": 523),
"FSK50"        :
*/

const getMaxSize = (sfbw) => {
    if (sfbw == "SF12BW125" ||
        sfbw == "SF11BW125" ||
        sfbw == "SF10BW125")
        return 51;
    if (sfbw == "SF9BW125")
        return 115;
    if (sfbw == "SF8BW125" ||
        sfbw == "SF7BW125" ||
        sfbw == "SF8BW250")
        return 222;
    console.log("Warning: Unhandled helium spreading: " + sfbw);
}

module.exports.api = {
    getVersionString: () => { return "Helium MQTT Integration"; },
    checkArgumentsOrExit: (args) => { 
        if (!args.u)
            printUsageAndExit("Helium: -u <mqtt broker user name> is required")
        if (!args.p)
            printUsageAndExit("Helium: -u <mqtt broker password> is required")
        if (!args.s)
            printUsageAndExit("Helium: -s <mqtt broker url> is required");
    },
    connectAndSubscribe: async (args, devices, onUplinkDevicePortBufferDateLatLng) => {
        args.v && console.log("Trying to connect to " + args.s);
        try {
            // Create an MQTT client instance
            /* const options = {
                // Clean session
                clean: true,
                connectTimeout: 4000,
                // Authentication
                clientId: args.u,
                username: args.u,
                password: args.p,
            } */
            
            const client  = mqtt.connect(args.s /*, options*/);

            client.on('connect', () => {
                args.v && console.log("Helium: Connected to mqtt broker");

                // Do we have a device list?
                if (Array.isArray(devices) && devices.length > 0) {
                    for (let i = 0; i < devices.length; ++i) {
                        const topic = `helium/vsm/rx/${devices[i].toUpperCase()}`;
                        client.subscribe(topic, (err) => {
                            if (err)
                                console.log(`Helium subscribe: ${topic} failed:` + err.message );
                            else
                                args.v && console.log(`Helium subscribed ok to ${topic}`);
                            });
                    }
                } else {
                    // Do a wildcard subscription to any device starting with the assigned range of
                    // Sensative DevEUIs
                    const topic = `helium/vsm/rx/#`;
                    client.subscribe(topic, (err) => {
                        if (err)
                            console.log(`Helium subscribe: ${topic} failed:` + err.message );
                        else
                            args.v && console.log(`Helium subscribed ok to ${topic}`);
                        });
                }
                });
            client.on('message', async (topic, message) => {
                // message is Buffer
                args.v && console.log(topic, message.toString());

                const obj = JSON.parse(message.toString('utf-8'));
                console.log(obj);
                const data = Buffer.from(obj.payload, "base64");
                const port = obj.port;
                const id = obj.dev_eui;
                
                let lat, lng;
                let date;
                let maxSize = 40; // Some default
                // Take first gateways lat & lng values, any gateway likely to hear this is likely within 150km
                if (obj.hotspots && obj.hotspots.length > 0) {
                    let gwinfo = obj.hotspots[0];
                    lat = gwinfo.lat;
                    lng = gwinfo.long;
                    maxSize = getMaxSize(gwinfo.spreading);
                }
                date = new Date(obj.reported_at);
                if (!date)
                    date = new Date()

                await onUplinkDevicePortBufferDateLatLng(client, id, port, data, date, lat, lng, maxSize);
            });
            return client;
        } catch (e) {
            console.log("Chirpstack: Got exception: " + e.message);
            throw e;
        }
    },
    sendDownlink: async (client, args, deviceId, port, data, confirmed) => {
        if (!Buffer.isBuffer(data))
            throw new Error("Helium sendDownlink: data must be a buffer object");
        const devEUI = deviceId.toUpperCase();
        const topic = `helium/vsm/tx/${devEUI}`;
        const obj = {
            confirmed,
            port,
            payload_raw: data.toString('base64'),
        };
        client.publish(topic, JSON.stringify(obj));
        args.v && console.log("Publish downlink on port " + port + " data: " + data.toString("hex"));
    },
}

