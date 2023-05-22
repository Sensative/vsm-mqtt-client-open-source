

let iotwireless;
const solvePosition = async (args, data) => {
  
  const isWifi = data.semtechEncoded && (data.semtechEncoded.msgtype === "wifi");

  let body = isWifi ? data.wifi : (data.semtechEncoded ? data.semtechEncoded : data.semtechGpsEncoded);
  body = JSON.parse(JSON.stringify(body)); // Make a copy of this object since it is manipulated below
  if (isWifi) {
    if ((!body.wifiAccessPoints) || body.wifiAccessPoints.length < 2) {
      console.log(data);
      throw new Error("Not enough access points to resolve wifi position")
    }
    body.wifiAccessPoints.forEach((accessPoint) => {
      accessPoint.Rss = accessPoint.signalStrength;
      delete accessPoint.signalStrength;
      accessPoint.MacAddress = accessPoint.macAddress
      delete accessPoint.macAddress;
    });
    const params = {
      WiFiAccessPoints: body.wifiAccessPoints,
    }
    console.log ('Sending request to AWS to resolve position');
    console.log('Params: ', params);
    return await iotwireless.getPositionEstimate(params, function(err, response) {
      if (err) {
        console.log('Something went wrong when calling "getPositionEstimate" for the AWS WiFi solver', err, err.stack);
      } else {
          const buf = Buffer.from(response.GeoJsonPayload);
          const decodedString = buf.toString();
          const decodedResponse = JSON.parse(decodedString);
          args.v && console.log("AWS WiFi solver response:", decodedResponse);
           return {
            latitude: decodedResponse?.coordinates[1],
            longitude: decodedResponse?.coordinates[0],
            verticalAccuracy: decodedResponse?.properties?.verticalAccuracy,
            verticalConfidenceLevel: decodedResponse?.properties?.verticalConfidenceLevel,
            horizontalAccuracy: decodedResponse?.properties?.horizontalAccuracy,
            horizontalConfidenceLevel: decodedResponse?.properties?.horizontalConfidenceLevel,
            positionTimestamp: decodedResponse?.properties?.timestamp,
          }
        }
    });
  } else {
    if (!body.msgtype === 'gnss' || !body?.gnss_capture_time || !body.payload) {
      console.log('Error, data:', body);
      throw new Error("Not enough information to resolve Gnss position");
    } else {
      const params = {
        "Gnss": {
          "CaptureTime": body?.gnss_capture_time,
          "Payload": body?.payload,
        }
      };
      return await iotwireless.getPositionEstimate(params, function(err, response) {
        if (err) {
          console.log('Something went wrong when calling "getPositionEstimate" for the AWS Gnss solver', err, err.stack);
        } else {
          const buf = Buffer.from(response.GeoJsonPayload);
          const decodedString = buf.toString();
          const decodedResponse = JSON.parse(decodedString);
          args.v && console.log("AWS Gnss solver response:", decodedResponse);
           return {
            latitude: decodedResponse?.coordinates[0],
            longitude: decodedResponse?.coordinates[1],
            altitude: decodedResponse?.coordinates[2],
            verticalAccuracy: decodedResponse?.properties?.verticalAccuracy,
            verticalConfidenceLevel: decodedResponse?.properties?.verticalConfidenceLevel,
            horizontalAccuracy: decodedResponse?.properties?.horizontalAccuracy,
            horizontalConfidenceLevel: decodedResponse?.properties?.horizontalConfidenceLevel,
            positionTimestamp: decodedResponse?.properties?.timestamp,
          }
        }
      });
    }
  }
}

module.exports.api = {
    solvePosition,
    checkArgumentsOrExit: (args)=>{if (args.z !== 'aws') throw new Error("Flag -z <aws> is required for AWS solver."); },
    getVersionString: ()=>"AWS Solver",
    initialize: (args) => {
      const CONSTANTS = require('../constants');
      const AWS = require('aws-sdk');
      AWS.config.apiVersions = {
        iotwireless: CONSTANTS.AWS.VERSION,
        // other service API versions
      };
      // Set the region and user credentials
      const config = {
          accessKeyId: CONSTANTS.AWS.ACCESS_KEY_ID,
          secretAccessKey: CONSTANTS.AWS.SECRET_ACCESS_KEY,
          region: CONSTANTS.AWS.REGION,
          // other service API versions
      }
      // Create the service object (IotWireless- Service)
      iotwireless = new AWS.IoTWireless(config);
    }
};
