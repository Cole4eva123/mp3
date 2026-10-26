var User = require('../models/user'),
    Task = require('../models/task'),
    h = require('./helpers');

function removeFromPending(task) {
    return User.updateMany({ pendingTasks: task.id }, { $pull: { pendingTasks: task.id } });
}

// Validate everything before the first write, so a failed request changes nothing
async function save(old, body) {
    var task = await h.build(Task, old, body);
    var user = null;

    if (task.assignedUser) {
        if (!h.isId(task.assignedUser)) throw h.error(400, 'assignedUser must be a valid user id');
        user = await User.findById(task.assignedUser);
        if (!user) throw h.error(404, 'Assigned user not found');
        if (task.$isDefault('assignedUserName')) task.assignedUserName = user.name;
        else if (task.assignedUserName !== user.name) throw h.error(400, 'assignedUserName does not match assignedUser');
    } else if (task.assignedUserName !== 'unassigned') {
        throw h.error(400, 'assignedUserName must be "unassigned" when assignedUser is empty');
    }

    await removeFromPending(task);
    if (user && !task.completed) await user.updateOne({ $addToSet: { pendingTasks: task.id } });
    await (old ? Task.replaceOne({ _id: task._id }, task) : task.save());
    return task;
}

module.exports = function (router) {

    router.route('/tasks')
        .get(h.list(Task, 100))
        .post(async function (req, res) {
            res.status(201).json({ message: 'Task created', data: await save(null, req.body) });
        });

    router.route('/tasks/:id')
        .get(h.one(Task))
        .put(async function (req, res) {
            var old = await h.find(Task, req.params.id);
            res.json({ message: 'Task updated', data: await save(old, req.body) });
        })
        .delete(async function (req, res) {
            var task = await h.find(Task, req.params.id);
            await removeFromPending(task);
            await task.deleteOne();
            res.json({ message: 'Task deleted', data: task });
        });

    return router;
};
