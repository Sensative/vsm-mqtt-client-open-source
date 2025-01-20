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

let translator;
try {
  translator = require('vsm-translator-open-source');
} catch (e) {
  console.log("Failed to load VSM translator. Did you do yarn install?");
  process.exit(1);
}

const store = process.env.VMC_STORE ? process.env.VMC_STORE : "./store";
const { initializeStore, fetchObjectFromStore, putObjectInStore, putErrorInStore, readDeviceList, getStoreName } = require(store);
console.log("Store: " + getStoreName());

const { mergeDeep, delay } = require('./util');
const { processRules} = require('./rules');

const isValidDate = (d) => {
  return d instanceof Date && !isNaN(d);
}

const isVsmDevice = (deveui) => {
  if (!deveui.toUpperCase().startsWith("70B3D52C"))
    return false;
  if (!deveui.length == 16)
    return false;
  
  // TODO: Filter out deveuis in correct range
  const id = Number.parseInt(deveui.substr(8, 8), 16);
  if (id >= 0x0001D4C5 && id < 0x0001E000)
    return true;

  return false;
}

const printUsageAndExit = (hint) => {
  console.log("Usage: node vsm-mqtt-client.js [-v] (-f <device id file> | -a) -i <integration name> -k <loracloud api key> -o <publisher> -d <decorator> -O <publisher>");
  console.log("      " + hint);
  process.exit(1);
}

// Exported for clients to use (intended for downlinks)
exports.getDevices = async (args) => {
  if (args.f) {
    let devices = await readDeviceList(args.f);
    if (devices.length == 0) {
      console.log("Note: No devices in device file, continuing anyway");
    }
    return devices;
  } else if (!args.w)
    printUsageAndExit();
}

// Exported for clients to use (intended for downlinks)
exports.getIntegration = async (args) => {
  let integration;
  try {
    const location = process.env.VMC_INTEGRATIONS ? process.env.VMC_INTEGRATIONS : "./integrations";
    integration = require(location + "/" + args.i);
    if (!(integration.api && integration.api.getVersionString && integration.api.checkArgumentsOrExit && integration.api.connectAndSubscribe)) {
      console.log("Integration " + args.i + " lacks a required function");
      process.exit(1);
    }
  } catch (e) {
    console.log(e.message);
    printUsageAndExit();
  }
  return integration;
}

// Exported for clients to use (intended for downlinks)
exports.getArgs = () => {
  return require('minimist')(process.argv.slice(2));
}

// Assigned below in runClient
let mqtt_client = undefined;

// Exported for clients to use (intended for downlinks)
exports.getMqttClient = () => {
  return mqtt_client;
}

exports.sendDownlink = async (args, deveui, port, buffer) => {
  const integration = this.getIntegration();
  // Either below means that initialization did not succeed. Throw!
  if (!integration)
    throw { message: "sendDownlink: Integration not initialized."};

  if (!this.getMqttClient())
    throw { message: "sendDownlink: MQTT not initialized."};

  await integration.api.sendDownlink(this.getMqttClient(), args, deveui, port, Buffer.from(buffer, "hex"), false /* confirmed */ );
}

const run = async () => {
  // Command line options handler (simple one)
  const args = this.getArgs();
  if (!args.i)
    printUsageAndExit("-i <Integration name> is required");
  if (!(args.f || args.w))
    printUsageAndExit("-f <device file> or -w is required");

  args.v && console.log("Selected integration: " + args.i);
  args.v && console.log("Device file: " + args.f);
  args.v && console.log("Selected decorator: " + (args.d ? args.d : "default"));

  // Initialize and or connect to the storage
  await initializeStore();

  //
  // Create the list of devices (device ID dependent on each integration), as an array of files
  //
  let devices = await this.getDevices(args);

  //
  // INTEGRATION
  //
  let integration = await this.getIntegration(args);
  // Allow the integration to check its arguments (e.g. server, credentials, etc)
  console.log("Integration: " + integration.api.getVersionString());
  integration.api.checkArgumentsOrExit(args);

  //
  // DECORATION
  //
  let decorator;
  try {
    const location = process.env.VMC_DECORATORS ? process.env.VMC_DECORATORS : "./decorators";
    decorator = require(location + "/" + (args.d ? args.d : "default"));
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
    const location = process.env.VMC_PUBLISHERS ? process.env.VMC_PUBLISHERS : "./publishers";
    publisher = require(location + "/" + (args.O ? args.O : "console"));
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

  //
  // SOLVER
  // 

  let solver = undefined;
  try {
    const location = process.env.VMC_SOLVERS ? process.env.VMC_SOLVERS : "./solvers";
    solver = require(location + "/" + (args.z ? args.z : "loracloud"));
    if (!(solver.api && solver.api.getVersionString && solver.api.checkArgumentsOrExit && solver.api.solvePosition && solver.api.loadAlmanac && solver.api.initialize)) {
      console.log("Solver " + args.z + " lacks a required function");
      process.exit(1);
    }
  } catch (e) {
    console.log(e.message); 
    printUsageAndExit();
  }
  // Allow the integration to check its arguments (e.g. server, credentials, etc)
  console.log("Positioning Solver: " + solver.api.getVersionString());
  solver.api.checkArgumentsOrExit(args);
  solver.api.initialize(args);

  // TIME SERIES PROCESSOR
  const seriesProcessor = process.env.VMC_PROCESSOR ? require(process.env.VMC_PROCESSOR) : undefined;
  if (seriesProcessor && seriesProcessor.onTimeSeries && seriesProcessor.getName) 
    console.log('Series Processor: ', seriesProcessor.getName());

  // Function to handle uplinks for a device id on a port with binary data in buffer
  const onUplinkDevicePortBufferDateLatLng = async (client, deviceid, port, buffer, date, lat, lng, maxSize) => {
    if (!(typeof(deviceid) == "string" && isFinite(port) && Buffer.isBuffer(buffer))) {
      console.log(`Integration error: Bad parameter to onUplinkDevicePortBufferDateLatLng:
                  typeof(deviceid):${typeof(deviceid)} (expect string), typeof(port)=${typeof(port)} (expect number), Buffer.isBuffer(buffer)=${Buffer.isBuffer(buffer)}`);
      throw new Error("Bad parameter");
    }

    if ((!isValidDate(date)) || process.env.VMC_DISTRUST_LNS_TIME)
      date = new Date();

  // If wildcarded, check that we have the correct series of deveuis,
  // unless yggio integration, which does its own check
    if (args.w && (!isVsmDevice(deviceid) && args.i !== 'yggio')) {
      args.v && console.log("Ignoring unrecognized device " + deviceid);
      return;
    }

    console.log("Uplink: device=" + deviceid + " port="+port + " buffer=" + buffer.toString("hex") + " date="+ date.toISOString() + " lat="+lat + " lng="+lng);

    // Read previous state for this node
    let previous = {};
    try {
      previous = await fetchObjectFromStore(deviceid);
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
          maxSize: maxSize,
      }
    }
    let result = {}
    try {
      const returned = translator.translate(iotnode);
      result = returned.result;
      let timeseries = returned.timeseries;
      args.v && timeseries && !seriesProcessor && console.log("Ignoring historical timeseries data:", JSON.stringify(timeseries));
      if (Array.isArray(timeseries) && seriesProcessor && seriesProcessor.onTimeSeries) {
        if (args.v) console.log("Invoking series processor " + seriesProcessor.getName() + " with " + timeseries.length + " measurements.");
        await seriesProcessor.onTimeSeries(deviceid, timeseries, iotnode);
      }
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

    next = await processRules(args, integration, client, solver, deviceid, next, result, date, lat, lng);

    // Store the next version of the object representation
    await putObjectInStore(deviceid, next, /* diff*/ result);

    // Publish the data
    publisher.api.publish(args, deviceid, decorator.api.decorate(next, deviceid));
  }

  const runClient = async () => {
    // Let the integration create connection and add required subscriptions
    try {
      mqtt_client = await integration.api.connectAndSubscribe(args, devices, onUplinkDevicePortBufferDateLatLng);
    } catch (e) {
      console.log("Failed to connect and subscribe: " + e.message);
      process.exit(1);
    }
    while (true) {
      args.v && console.log(new Date().toISOString() + " active");
      await delay(60000);
    }  
  }
  await runClient();
}

run();
