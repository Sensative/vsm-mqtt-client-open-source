#!/bin/bash
set -e

# Merge main if there are changes, but keep our package.json
git fetch origin main
if ! git diff --quiet HEAD...origin/main; then
    git merge origin/main --no-commit --no-ff || true
    git checkout --ours package.json
    git add package.json
    git diff --cached --quiet || git commit -m "Merge origin/main, keeping local package.json"
fi

# Bump patch version in package.json
current_version=$(node -p "require('./package.json').version")
new_version=$(echo "$current_version" | awk -F. '{print $1"."$2"."$3+1}')
sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json

# Bump dependency version
current_dep=$(node -p "require('./package.json').dependencies['@lifefinder/vsm-translator-open-source']")
new_dep=$(echo "$current_dep" | awk -F. '{print $1"."$2"."$3+1}')
sed -i "s|\"@lifefinder/vsm-translator-open-source\": \"$current_dep\"|\"@lifefinder/vsm-translator-open-source\": \"$new_dep\"|" package.json

echo "Bumped version: $current_version -> $new_version"
echo "Bumped dependency: $current_dep -> $new_dep"

# Commit version bump
git add package.json
git commit -m "Bump version to $new_version"

# Push to remote
git push

echo ""
echo "Done! Now run: npm publish"
