const fs = require("fs");
const readline = require("readline");
const moment = require("moment");
const { google } = require("googleapis");
const { getIssues: getJiraIssues, updateDueDate: updateJiraDueDate } = require("./jiratasks");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/tasks"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json";

// Load client secrets from a local file.
fs.readFile("credentials.json", async (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Authorize a client with credentials, then call the Google Tasks API.
    authorize(JSON.parse(content), main);
});

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES
    });
    console.log("Authorize this app by visiting this url:", authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question("Enter the code from that page here: ", code => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error("Error retrieving access token", err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
                if (err) return console.error(err);
                console.log("Token stored to", TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

const createNewTask = async (auth, tasklist, title, description, resolution, resolutionDate, duedate) => {
    const service = google.tasks({ version: "v1", auth });
    await timeout(1000);
    let requestBody = { title, notes: description };
    if (resolution && resolutionDate) {
        requestBody.status = "completed";
        requestBody.completed = moment(resolutionDate).format("YYYY-MM-DDTHH:mm:ssZ");
    }

    if (duedate) {
        requestBody.due = moment(duedate).format("YYYY-MM-DDTHH:mm:ssZ");
    }

    try {
        const result = await service.tasks.insert({ tasklist, requestBody });
    } catch (err) {
        console.log(`Error creating new task: ${title}`);
        console.log(err);
    }
};

const updateGoogleDueDate = async (auth, tasklist, taskId, dueDate) => {
    const service = google.tasks({ version: "v1", auth });
    try {
        const result = await service.tasks.update({
            tasklist,
            task: taskId,
            requestBody: { id: taskId, due: moment(dueDate).format("YYYY-MM-DDTHH:mm:ssZ") }
        });
    } catch (err) {
        console.log(`Error updating task: ${taskId}`);
        console.log(err);
    }
};

const completeTask = async (auth, tasklist, taskId, resolutionDate) => {
    const service = google.tasks({ version: "v1", auth });
    try {
        const result = await service.tasks.update({
            tasklist,
            task: taskId,
            requestBody: { id: taskId, status: "completed", completed: moment(resolutionDate).format("YYYY-MM-DDTHH:mm:ssZ") }
        });
    } catch (err) {
        console.log(`Error updating task: ${taskId}`);
        console.log(err);
    }
};

const getTaskPage = async (auth, tasklist, nextPageToken, tasks) => {
    const service = google.tasks({ version: "v1", auth });
    let tasksSoFar = [];
    if (tasks) {
        tasksSoFar = tasks;
    }
    let query = { tasklist, maxResults: 10 };
    if (nextPageToken) {
        query.pageToken = nextPageToken;
    }
    const thisPageTasks = await service.tasks.list(query);
    tasksSoFar = tasksSoFar.concat(thisPageTasks.data.items);
    if (thisPageTasks.data.nextPageToken) {
        return await getTaskPage(auth, tasklist, thisPageTasks.data.nextPageToken, tasksSoFar);
    }
    return tasksSoFar;
};

/**
 * Lists the user's first 10 task lists.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
const listGoogleTasks = async auth => {
    const service = google.tasks({ version: "v1", auth });

    const taskLists = await service.tasklists.list();
    let allTasks = [];
    if (taskLists.data.items) {
        allTasks = await Promise.all(
            taskLists.data.items.map(async taskList => {
                const tasks = await getTaskPage(auth, taskList.id);
                return tasks;
            })
        );
        return allTasks.flat();
    } else {
        console.log("No task lists found.");
    }
};

const getFirstTaskList = async auth => {
    const service = google.tasks({ version: "v1", auth });
    const taskLists = await service.tasklists.list();
    return taskLists.data.items[0];
};

const makeTaskName = task => {
    return `[${task.key}] ${task.fields.summary}`;
};

const datesEqual = (d1, d2) => {
    return (
        moment(d1)
            .startOf("day")
            .toISOString() ===
        moment(d2)
            .startOf("day")
            .toISOString()
    );
};

const main = async auth => {
    const taskList = await getFirstTaskList(auth);
    const allJiraTasks = await getJiraIssues();
    const allGoogleTasks = await listGoogleTasks(auth);

    for (let i = 0; i < allJiraTasks.length; i++) {
        // allJiraTasks.forEach(async jTask => {
        const jTask = allJiraTasks[i];
        const taskName = makeTaskName(jTask);
        const gTaskFilter = allGoogleTasks.filter(t => {
            return taskName === t.title;
        });
        if (gTaskFilter.length < 1) {
            // New task needed
            const description = `${jTask.fields.description}\n\n${process.env.JIRA_URL}/browse/${jTask.key}`;
            console.log(`creating task: ${taskName}`);

            await createNewTask(auth, taskList.id, taskName, description, jTask.fields.resolution, jTask.fields.resolutionDate);
        } else {
            // might need updating
            const gTask = gTaskFilter[0];
            if (jTask.fields.resolution && gTask.status != "completed") {
                console.log(`completing task: ${taskName}`);
                await completeTask(auth, taskList.id, gTask.id, jTask.fields.resolutionDate);
            } else if (gTask.due && !datesEqual(jTask.fields.duedate, gTask.due)) {
                await updateJiraDueDate(jTask.key, gTask.due);
                console.log(`Updating due date for task: ${taskName}`);
            }
        }
    }
    console.log(`${moment().toISOString()} -- completed Jira & Google Tasks sync\n\n`);
};
