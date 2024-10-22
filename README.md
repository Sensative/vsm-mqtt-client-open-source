# VSM MQTT Client "Munin"

Decoding and managing the Sensative new generation of products based on the Virtual Sensoring Machine technology.

# What is it?

* Software Service which will Translate Sensative AB Puck, Box, Square, and Lifefinder data. 
* Manage GNSS almanac and assistance position updates for the devices over LoRaWan.
* Solve positions
* Manage device time in LoraWan networks which lack this feature
* Format the device data
* Forward the device data to the wanted destination.

# License
MIT License, see license file.

# Installation

## Using NPM

### Add it to your project
* Add the following to your package.json

```
{
  "dependencies": {
    ...
    "vsm-mqtt-client-open-source": ">0.0.1"
  }
}
```
Or run ```yarn install vsm-mqtt-client-open-source```

### Use the environment to set up your own custom Decorators, Publishers, Storage, etc. See the vsm-mqtt-client

## As a fork
Clone the repository
At the top level, run yarn install

## Adding support for AWS Cloud Solver
If you wish to run the program with the AWS Cloud solver follow the below steps

At the top level run yarn add aws-sdk
Locate the constants.json file and fill out the required fields, e.g:
{
    "AWS": {
        "VERSION": "<SDK VERSION>", Format: 
        "ACCESS_KEY_ID": "<YOUR ACCESS KEY ID>",
        "SECRET_ACCESS_KEY": "<YOUR SECRET ACCESS KEY>",
        "REGION": "<YOUR REGION, EU NORTH IS NOT SUPPORTED>"
    }
}

Nota bene, the AWS Cloud Solver does not support GNSS almanac updates at the time of writing this.

# Running

This is expecting node, tried on node version 18, 19 and 20.

General arguments:
* -v Run in verbose mode, will generate extra log printouts (no argument)
* -f <filename> Select device identity file (can be substituted with  -w for some integrations)
* -w Wildcard all devices available on the server matching a Sensative DevEUI
* -i <integration> Select integration (see integrations folder for list of available integrations)
* -k <api key> Enter the API key for semtech loracloud location services (required for GNSS and WIFI solve)
* -d <decorator> Select decorator (see decorators folder for list of available decorators). If omitted the full translated object with all bookkeeping data will be used.
* -O <publisher> Select publisher (see publishers folder for list of available publishers). If omitted the publishing will be only to the console.
* -z <solver> Select a GNSS almanac and solution provider. Defaults to loracloud.
* -N Do not invoke solver, but still use it for GNSS almanac updates (assume solving is done elsewhere in chain)

## Environment variables

As a separate extension mechanism, environment variables can also be used to specify the various components, such as store, decorator, etc (see folder structure below). This is in order to work better as a npm import with customizations instead of through the forking mechanism.

# Integrations
Where is raw device data fetched and where do we send downlinks?

## Running with Chirpstack 3.x
Extra Arguments
* -a <n> Provide the application id (an integer number) in which the device ids are valid
* -s mqtts://<chirpstack server url> Select the URL of the chirpstack server in use

Example command line
```
node vsm-mqtt-client.js -v -f chirpstack-devices.list  -i chirpstack3 -a 12 -s mqtts://chirpstack.company.com -k AQEAf8i6p8...
```
## Running with Chirpstack 4
Note - this integration is not completed since downlinks are not yet implemented which means that the rules will not have effect (and hence devices are not properly updated with almanacs, device time relies on the device).

Example command line
```
node vsm-mqtt-client.js -v -f chirpstack-devices.list  -i chirpstack3 -a appname -s mqtts://chirpstack.company.com -k AQEAf8i6p8...
```

## Running with Helium
A general note: At the time of writing this I do not get device time support from Helium. This is solved at application level by this service, but gives lower time precision than LoRaWan native device time.

Extra arguments
* - s mqtts://<mqtt broker URL> Select the URL of the broker
* - u <username> User name on the broker (possibly ignored)
* - p <password> Password on the broker for the selected user (possibly ignored)

## Helium Console integration
It is assumed that the device EUI is used as identifier. This means that your MQTT integration topics need be updated to use device_eui instead of device_id (which is the default).

```
Uplink topic: helium/vsm/rx/{{device_eui}}

Downlink topic: helium/vsm/tx/{{device_eui}}

```
Point the console to the same mqtt broker.

## Running with Yggio
Needs Chirpstack 3.x and Yggio MongoDB running.

Requires the following environment variables to be set in constants.json:
* MONGODB.URI - MongoDB connection URI

Extra Arguments
* -a <n> Provide the application id (an integer number) in which the device ids are valid
* -s mqtts://<chirpstack server url> Select the URL of the chirpstack server in use

### Notes
While experimenting with this it was clear that the helium console did not work with HiveMQ cloud,

### Example command lines
node vsm-mqtt-client.js -v -w -i helium -s mqtt://test.mosquitto.org:1883 -k AQEAf8i... -u username -p pass Run with all devices, using helium as lora server (set up to push data to test.mosquitto.org)

# Decorators
The decorator can be selected or developed to filter or transform the data so it fits the application.

# Publishers
Publishers have the role of making the decorated translated data available to downstream applications.

## Console Publisher
The console publisher (default) is selected with the -O console command line option. It will print a formatted version of the decorated object to the command line.

## HTTP(s) publisher
The HTTPS publisher is selected with the -O https command line option.

### Extra command line arguments
The HTTPS publisher will require an additional command line argument
```
-S <URL> Select the URL for the target. The object will be passed as application/json and in the format given by the decorator. 
```
Note: It would be simple to add an option to replace a placeholder in the url with the deveui of the device.

### 

## MQTT publisher
The mqtt publisher (mqtt) is selected with the -O mqtt command line option.

### Extra command line arguments
The MQTT publisher will require two additional command line arguments
```
-S <mqtt broker url> Select the URL for the target MQTT broker
-T <topic format> Decide the topic format for the published data. 
```
### Topic Format
The topic format is used to format how the mqtt publishing is done. Basically it will be done literally as is, the only exception is that the text deveui will be replaced with the deveui of the device in lowercase OR the text DEVEUI will be replaced with the device deveui in UPPERCASE.

### Command line example
Run select devices with data from helium, publish only latest values to mqtt node vsm-mqtt-client.js -f helium-devices.list  -i helium -s mqtt://test.mosquitto.org:1883 -k AQEAf8i6p... -u test -p pass -d minimal -O mqtt -S mqtt://test.mosquitto.org:1883 -T interpreted/deveui/data

Run with data from helium, all devices, print full data to console node vsm-mqtt-client.js -w -i helium -s mqtt://test.mosquitto.org:1883 -k AQEAf8i6... -u test -p pass


# Extensibility
To add your own implementations there is a series of different environment variables that can be set to override the defaults. See the implementation in vsm-mqtt-client.js for the full list. Use this as an alternative to forking this repository and isolating your changes and additions.

# Code Structure
This code is designed to listen to a lorawan network server publishing the raw uplinks from a VSM device. It will translate it correctly and can additionally control the device with necessary downlinks to keep it up-to-date with regards to assistance positions. Once new data is available it will be re-published using a publisher and finally the data will be stored using the storage mechanism.

## vsm-mqtt-client.js
The main file which ties together the below components and contains the main logic.

## integrations/
Contains the currently supported integrations. Each integration can have their own options.

## decorators/
Contains the currently supported decorators. A decorator transforms the actual representation of the data into something palatable by the user, e.g. it can change names of fields or filter out information of no interest to the user (there is plenty of bookkeeping information in the translated object).

## publishers/
Contains the currently supported publishers. A publisher will publish the data from the integration, translated and decorated. The publishers include an mqtt publisher and a console publisher.

## solvers/
Contains the solver implementations. The default is loracloud but provide -z argument to select none or some of the other solvers. Currently loracloud is the default solver, but aws and none is options. With none selected no position solving is enabled.

## store.js
Provides object storage and error storage. This is required in order to save the state of the sensors between uplinks.

## util.js
Utility functions, in particular object merging

## solvers/loracloud.js
Client code to the lora cloud. You will have to provide your own API key [-k option] in order to use the loracloud solver functionality.

## solvers/aws.js
Client code to the aws implementation of lora cloud. You will have to provide your own AWS Access Key Id and Secret Access Key in order to use the AWS solver functionality. As of now AWS does not support full almanac download

## rules.js
Rules for updating the device with downlinks depending on the device state.

# Suggested extensions
* Add support for skipping the list of devices, instead use MQTT wildcards and filter on the deveui range
* vsm-translator-open-source
The device data translator is a separate open source repository. It contains the functionality for decoding all of the products and versions released by Sensative. It is recommended to frequently update this as new products and versions are published frequently.
* Add support for other products by generalizing the translator selection per device
