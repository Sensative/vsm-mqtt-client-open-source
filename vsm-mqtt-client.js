/*
The MIT License (MIT)

Copyright Sensative AB 2023. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const mqtt = require('mqtt');

const translator = require('vsm-translator');
const { isDate } = require('util/types');
const { initializeStore, fetchObjectFromStore, putObjectInStore, putErrorInStore, readDeviceList } = require('./store');
const { mergeDeep, delay } = require('./util');
const { processRules} = require('./rules');

const printUsageAndExit = () => {
  console.log("Usage: node index.js [-v] -f <device id file> -i <integration name> -k <loracloud api key> -o <publisher> -d <decorator>");
  process.exit(1);
}

// Command line options handler (simple one)
const args = require('minimist')(process.argv.slice(2));
if (!(args.i && args.f))
  printUsageAndExit();

args.v && console.log("Selected integration: " + args.i);
args.v && console.log("Device file: " + args.f);
args.v && console.log("Selected decorator: " + (args.d ? args.d : "default"));

// Initialize and or connect to the storage
initializeStore();

//
// Create the list of devices (device ID dependent on each integration), as an array of files
//
let devices = readDeviceList(args.f);
if (devices.length == 0) {
  printUsageAndExit();
}

if (devices.length == 0) {
  console.log("No devices in device file");
  printUsageAndExit();
}

//
// INTEGRATION
//
let integration = undefined;
try {
  integration = require("./integrations/" + args.i);
  if (!(integration.api && integration.api.getVersionString && integration.api.checkArgumentsOrExit && integration.api.connectAndSubscribe)) {
    console.log("Integration " + args.i + " lacks a required function");
    process.exit(1);
  }
} catch (e) {
  console.log(e.message);
  printUsageAndExit();
}
// Allow the integration to check its arguments (e.g. server, credentials, etc)
console.log("Integration: " + integration.api.getVersionString());
integration.api.checkArgumentsOrExit(args);

//
// DECORATION
//
let decorator;
try {
  decorator = require("./decorators/" + (args.d ? args.d : "default"));
  if (!(decorator.api && decorator.api.decorate && decorator.api.getVersionString)) {
    console.log("Decoration " + args.d + " lacks a required function");
    process.exit(1);
  }
} catch (e) {
  console.log(e.message);
  printUsageAndExit();
}
console.log("Decoration: " + decorator.api.getVersionString());

//
// PUBLISHER
// 

let publisher = undefined;
try {
  publisher = require("./publishers/" + (args.O ? args.O : "console"));
  if (!(publisher.api && publisher.api.getVersionString && publisher.api.checkArgumentsOrExit && publisher.api.publish)) {
    console.log("Publisher " + args.O + " lacks a required function");
    process.exit(1);
  }
} catch (e) {
  console.log(e.message); 
  printUsageAndExit();
}
// Allow the integration to check its arguments (e.g. server, credentials, etc)
console.log("Publisher: " + publisher.api.getVersionString());
publisher.api.checkArgumentsOrExit(args);
publisher.api.initialize(args);

// Function to handle uplinks for a device id on a port with binary data in buffer
const onUplinkDevicePortBufferDateLatLng = async (client, deviceid, port, buffer, date, lat, lng) => {
  if (!(typeof(deviceid) == "string" && isFinite(port) && Buffer.isBuffer(buffer) && isDate(date))) {
    console.log("Integration error: Bad parameter to onUplinkDevicePortBuffer");
    throw new Error("Bad parameter");
  }

  console.log("Uplink: device=" + deviceid + " port="+port + " buffer=" + buffer.toString("hex") + " date="+ date.toISOString() + " lat="+lat + " lng="+lng);

  // Read previous state for this node
  let previous = {};
  try {
    previous = fetchObjectFromStore(deviceid);
    // args.v && console.log("previous:", previous);
  } catch (e) {
    args.v && console.log(`Note: No previous data for device ${deviceid}`);
  }

  // Run translation
  let iotnode = { ...previous, 
    encodedData : {
        port : port,
        hexEncoded : buffer.toString('hex'),
        timestamp: date,  // TBD if this should be given by the integration instead?
    }
  }
  let result = {}
  try {
    const returned = translator.translate(iotnode);
    result = returned.result;
    let timeseries = returned.timeseries;
    // For now since there is no underlying timeseries database, ignore the timeseries part of the result, 
    // e.g. data older than the most recent data.
    args.v && timeseries && console.log("Ignoring historical timeseries data:", JSON.stringify(timeseries));
  } catch (e) {
    console.log("Failed translation: ", e.message);
    putErrorInStore(deviceid, e);
  }

  if (!result) {
    // In case we are just filling up with time series data from previous measurements
    console.log("No new results from translator\n");
    return;
  }

  let next = mergeDeep(iotnode, result);

  next = await processRules(args, integration, client, deviceid, next, result, date, lat, lng);

  // Store the next version of the object representation
  putObjectInStore(deviceid, next);

  // Publish the data
  publisher.api.publish(args, deviceid, decorator.api.decorate(next));
}

const run = async () => {
  // Let the integration create connection and add required subscriptions
  let client = undefined;
  try {
    client = await integration.api.connectAndSubscribe(args, devices, onUplinkDevicePortBufferDateLatLng);
  } catch (e) {
    console.log("Failed to connect and subscribe: " + e.message);
    process.exit(1);
  }
  while (true) {
    args.v && console.log(new Date().toISOString() + " active");
    await delay(60000);
  }  
}

run();
