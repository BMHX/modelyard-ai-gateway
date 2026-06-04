"use server";

import { updateWorkspaceGuidePreference } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

export type UpdateWorkspaceGuidePreferenceActionResult =
  | {
      status: "success";
      guideExitedWorkspaceIds: string[];
    }
  | {
      status: "error";
      message: string;
      guideExitedWorkspaceIds: null;
    };

export async function updateWorkspaceGuidePreferenceAction(input: {
  workspaceId: string;
  exited: boolean;
}): Promise<UpdateWorkspaceGuidePreferenceActionResult> {
  try {
    const result = await updateWorkspaceGuidePreference({
      workspaceId: input.workspaceId.trim(),
      exited: input.exited,
    });

    return {
      status: "success",
      guideExitedWorkspaceIds: result.guideExitedWorkspaceIds,
    };
  } catch (error) {
    return {
      status: "error",
      message: getUserErrorMessage(error, "Can't save this preference right now."),
      guideExitedWorkspaceIds: null,
    };
  }
}
