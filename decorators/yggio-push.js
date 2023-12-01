// Publisher which does a transformation to vaguely resemble the format of yggio pushes

module.exports.api = {
    decorate: (obj, deveui) => {
        return { payload: { iotnode: { _id:deveui.toLowerCase(), ...obj } } };
    },
    getVersionString: () => {
        return "Yggio-like push transformation (add payload.iotnode._id field)";
    }
}

