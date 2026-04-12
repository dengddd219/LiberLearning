"""
Shared utilities for alignment strategies.

Provides time-axis constraint helpers used by V1.1, V2.1, V3a.1, V3b.1.

Time constraint design:
  - Pages are monotonically non-decreasing (teacher moves forward, rarely back)
  - Search window: [current_page, current_page + TIME_WINDOW]
  - Pages outside the window are masked to -inf before argmax
  - current_page updates to max(current_page, assigned_page) after each segment
"""

import numpy as np

TIME_WINDOW = 3  # 最大允许单次向前跳跃页数


def apply_time_mask(
    sim_row: np.ndarray,
    current_page: int,
    page_nums: list[int],
) -> np.ndarray:
    """
    Mask similarity scores outside [current_page, current_page + TIME_WINDOW].

    Args:
        sim_row:      1-D array of shape (P,) — similarities for one segment
        current_page: the current confirmed page number (1-based)
        page_nums:    list of page numbers corresponding to each column

    Returns:
        masked similarity array — out-of-window entries set to -inf
    """
    masked = sim_row.copy()
    lo = current_page
    hi = current_page + TIME_WINDOW
    for j, pn in enumerate(page_nums):
        if pn < lo or pn > hi:
            masked[j] = -np.inf
    return masked
