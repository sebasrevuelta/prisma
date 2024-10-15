#!/bin/sh
echo 'export SEMGREP_APP_TOKEN=$SEMGREP_APP_TOKEN' >> $BASH_ENV
echo 'export SEMGREP_COMMIT=$CIRCLE_SHA1' >> $BASH_ENV
echo 'export SEMGREP_JOB_URL=$CIRCLE_BUILD_URL' >> $BASH_ENV
echo "Service parameter value is $SERVICE_PARAM"
CIRCLE_REPOSITORY_URL='https://github.com/sebasrevuelta/prisma/'
SEMGREP_REPO_URL="$CIRCLE_REPOSITORY_URL"
echo 'export SEMGREP_REPO_URL=$CIRCLE_REPOSITORY_URL' >> $BASH_ENV
REPO_NAME=$(basename -s .git "$SEMGREP_REPO_URL")
PR_NUMBER=$(echo "$CIRCLE_PULL_REQUEST" | awk -F '/' '{print $NF}' )
if [ -n "$PR_NUMBER" ]; then
    echo 'export SEMGREP_BASELINE_REF="origin/<< pipeline.parameters.master_branch >>"' >> $BASH_ENV
    echo "Pull Request Number: $PR_NUMBER"
    echo 'export SEMGREP_PR_ID=$PR_NUMBER' >> $BASH_ENV
    git fetch origin "+refs/heads/*:refs/remotes/origin/*"
    root=$(pwd)
    # Identify package.json files modified in the PR
    MODIFIED_PACKAGE_JSON=$(git diff --name-only $(git merge-base development HEAD) | grep 'package.json')

    # Loop through each modified package.json and create a temporary lockfile
    if [ -n "$MODIFIED_PACKAGE_JSON" ]; then
        for file in $MODIFIED_PACKAGE_JSON; do
            # Get the directory of the package.json file
            dir=$(dirname $file)

            # Install dependencies with pnpm to generate a temporary lockfile
            cd $dir
            pnpm install --lockfile-only
            cd $root

            # Run Semgrep on the generated lockfile and current dir
            echo 'export SEMGREP_REPO_DISPLAY_NAME=$dir' >> $BASH_ENV
            semgrep ci --baseline-commit=$(git merge-base development HEAD) --include=$dir
        done
    else
        echo "No package.json changes found, skipping lockfile check."
    fi
fi
