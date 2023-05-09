// Publisher which only displays output on standardout

module.exports.api = {
    checkArgumentsOrExit: (args) => { },
    initialize: (args) => { },
    publish: (args, deviceid, obj) => {
        // console.log(deviceid, obj);
        console.log('published.')
    },
    getVersionString: () => {
        return "Console Publisher";
    }
}

