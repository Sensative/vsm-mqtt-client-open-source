#!/bin/bash
set -e

merged_main=false
dep_updated=false

# Merge main if there are changes, but keep our package.json
git fetch origin main
if ! git diff --quiet HEAD...origin/main; then
    git merge origin/main --no-commit --no-ff || true
    git checkout --ours package.json
    git add package.json
    git diff --cached --quiet || git commit -m "Merge origin/main, keeping local package.json"
    merged_main=true
    echo "Merged changes from main"
fi

# Check dependency version against npm
current_dep=$(node -p "require('./package.json').dependencies['@lifefinder/vsm-translator-open-source']")
current_dep_stripped=$(echo "$current_dep" | sed 's/^[\^~]//')
new_dep=$(npm view @lifefinder/vsm-translator-open-source version 2>/dev/null)
if [ -z "$new_dep" ]; then
    echo "Error: Could not fetch latest version of @lifefinder/vsm-translator-open-source from npm"
    exit 1
fi
if [ "$current_dep_stripped" != "$new_dep" ]; then
    sed -i "s|\"@lifefinder/vsm-translator-open-source\": \"$current_dep\"|\"@lifefinder/vsm-translator-open-source\": \"$new_dep\"|" package.json
    dep_updated=true
    echo "Bumped dependency: $current_dep -> $new_dep"
else
    echo "Dependency already at latest: $current_dep"
fi

# Only bump version if there were changes
if [ "$merged_main" = true ] || [ "$dep_updated" = true ]; then
    current_version=$(node -p "require('./package.json').version")
    new_version=$(echo "$current_version" | awk -F. '{print $1"."$2"."$3+1}')
    sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
    echo "Bumped version: $current_version -> $new_version"

    # Commit and push
    git add package.json
    git commit -m "Bump version to $new_version"
    git push

    echo ""
    echo "Done! Now run: npm publish"
else
    echo ""
    echo "No changes to publish (no merge from main, dependency already current)"
fi
