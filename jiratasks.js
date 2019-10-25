const JiraClient = require("jira-connector");

const getIssues = async () => {
    const jira = new JiraClient({
        host: process.env.JIRA_URL.replace("https://", ""),
        basic_auth: {
            email: process.env.JIRA_USERNAME,
            api_token: process.env.JIRA_API_KEY
        }
    });

    const jql = "assignee = currentUser() and project NOT IN (HELP, EXHELP)";
    const maxResults = 50;
    const fields = ["resolution", "description", "summary", "resolutiondate", "duedate"];
    let startAt = 0;
    let totalResults = 1;
    let keepScanning = true;
    let issues = [];

    while (keepScanning) {
        const result = await jira.search.search({ jql, startAt, maxResults, fields });

        totalResults = result.total;
        issues = issues.concat(result.issues);
        startAt += maxResults;
        if (startAt > totalResults) {
            keepScanning = false;
        }
    }
    return issues;
};

const updateDueDate = async (issueKey, duedate) => {
    const jira = new JiraClient({
        host: process.env.JIRA_URL.replace("https://", ""),
        basic_auth: {
            email: process.env.JIRA_USERNAME,
            api_token: process.env.JIRA_API_KEY
        }
    });
    const edit = await jira.issue.editIssue({ issueKey, issue: { fields: { duedate } } });
    return edit;
};

module.exports = { getIssues, updateDueDate };
