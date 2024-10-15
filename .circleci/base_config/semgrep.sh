#!/bin/sh
echo 'export SEMGREP_APP_TOKEN=$SEMGREP_APP_TOKEN' >> $BASH_ENV
echo 'export SEMGREP_COMMIT=$CIRCLE_SHA1' >> $BASH_ENV
echo 'export SEMGREP_JOB_URL=$CIRCLE_BUILD_URL' >> $BASH_ENV
echo "Service parameter value is $SERVICE_PARAM"
REPO_URL="$CIRCLE_REPOSITORY_URL"
REPO_NAME=$(basename -s .git "$REPO_URL")
PR_NUMBER=$(echo "$CIRCLE_PULL_REQUEST" | awk -F '/' '{print $NF}' )
if [ -n "$PR_NUMBER" ]; then 
    echo 'export SEMGREP_BASELINE_REF = "origin/<< pipeline.parameters.master_branch >>"' >> $BASH_ENV
    echo "Pull Request Number: $PR_NUMBER"
    echo 'export SEMGREP_PR_ID=$PR_NUMBER' >> $BASH_ENV
    git fetch origin "+refs/heads/*:refs/remotes/origin/*"
    export SEMGREP_REPO_DISPLAY_NAME=$REPO_NAME/$SERVICE_PARAM
    semgrep ci --baseline-commit=$(git merge-base development HEAD)
else
    if [ "$CIRCLE_BRANCH" == "development" ]; then
        echo "Running Full scan for branch: $CIRCLE_BRANCH and service: $SERVICE_PARAM"
        export SEMGREP_REPO_DISPLAY_NAME=$REPO_NAME/$SERVICE_PARAM
        semgrep ci --include=$SERVICE_PARAM/** || true
    else
        echo "Skipping full scan for branches different to development."
    fi
fi
