# GitHub Flow

GitHub Flow is a lightweight, branch-based workflow. It relies on feature branches and Pull Requests to manage code changes. Its core principles and steps are as follows:

1.  **The `main` branch is sacred**: Any code in the `main` branch must be stable and always ready to be deployed (released). Committing directly to the `main` branch is forbidden.

2.  **Create a feature branch**: For any new work (be it a new feature or a bug fix), a new, descriptively named branch must be created from `main`. For example, `feat/add-caching-layer` or `fix/login-bug`.

3.  **Commit on the branch**: All related code modifications and commits are made on this newly created feature branch. Multiple commits are encouraged.

4.  **Open a Pull Request (PR)**: When the work on the feature branch is complete, a Pull Request is opened from that branch to the `main` branch. A PR is a request for team members to review your code and merge it into `main`.

5.  **Discuss and Review**: The PR is the central place for code review. Team members can comment, ask questions, and discuss the code. If changes are needed, you can continue to push commits to the feature branch, and the PR will update automatically.

6.  **Merge**: Once the PR is approved, it can be merged into the `main` branch. After merging, `main` contains the new feature and remains stable and deployable.

7.  **Delete the feature branch**: After the merge, the feature branch has served its purpose and can be deleted.
