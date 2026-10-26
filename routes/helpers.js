var mongoose = require('mongoose');

function error(status, message) {
    var err = new Error(message);
    err.status = status;
    return err;
}

var isId = mongoose.isObjectIdOrHexString;

// Query string parameters are JSON encoded
function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    try {
        return JSON.parse(query[key]);
    } catch (e) {
        throw error(400, 'Invalid JSON in "' + key + '" parameter');
    }
}

// Malformed ids in the URL are reported as 404: that resource does not exist
async function find(Model, id, select) {
    var doc = isId(id) && await Model.findById(id).select(select);
    if (!doc) throw error(404, Model.modelName + ' not found');
    return doc;
}

// POST and PUT build the whole document from the body; PUT keeps only the old _id and dateCreated
async function build(Model, old, body) {
    var doc = new Model(Object.assign({}, body, {
        _id: old ? old._id : undefined,
        dateCreated: old ? old.dateCreated : undefined
    }));
    await doc.validate().catch(function (err) {
        throw error(400, 'Missing or invalid fields: ' + Object.keys(err.errors).join(', '));
    });
    return doc;
}

function list(Model, defaultLimit) {
    return async function (req, res) {
        var query = Model.find(parse(req.query, 'where', {}))
            .sort(parse(req.query, 'sort'))
            .select(parse(req.query, 'select'))
            .skip(parse(req.query, 'skip'))
            .limit(parse(req.query, 'limit', defaultLimit));
        res.json({ message: 'OK', data: parse(req.query, 'count') === true ? await query.countDocuments() : await query });
    };
}

function one(Model) {
    return async function (req, res) {
        res.json({ message: 'OK', data: await find(Model, req.params.id, parse(req.query, 'select')) });
    };
}

module.exports = { error: error, isId: isId, find: find, build: build, list: list, one: one };
