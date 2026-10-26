/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', require('./home.js')(router));

    // Express 5 forwards errors thrown in async handlers here
    app.use(function (err, req, res, next) {
        if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message, data: {} });
        // Bad values in where/sort/select fail when Mongoose casts them
        if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid query value', data: {} });
        console.error(err);
        res.status(500).json({ message: 'Server error', data: {} });
    });
};
