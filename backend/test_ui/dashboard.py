"""
Dashboard tab — cost summary, per-step breakdown, alignment quality chart.
"""
import streamlit as st

from test_ui.helpers import _load_json, _log_path


def render_dashboard():
    st.title("📊 Run Dashboard")

    log_path = _log_path()
    if not log_path.exists():
        st.info("No runs logged yet. Run the pipeline steps first.")
        return

    import pandas as pd
    log = _load_json(log_path)
    df  = pd.DataFrame(log)

    st.subheader("Cumulative Cost")
    total_cost = df["cost_usd"].sum()
    total_tok  = df["tokens"].sum()
    c1, c2, c3 = st.columns(3)
    c1.metric("Total cost (USD)", f"${total_cost:.4f}")
    c2.metric("Total tokens", f"{int(total_tok):,}")
    c3.metric("Total runs logged", len(df))

    st.divider()

    st.subheader("Per-step Breakdown")
    step_summary = (df.groupby("step")
                      .agg(runs=("step","count"),
                           avg_elapsed=("elapsed_s","mean"),
                           total_cost=("cost_usd","sum"),
                           total_tokens=("tokens","sum"))
                      .reset_index()
                      .rename(columns={
                          "step": "Step",
                          "runs": "Runs",
                          "avg_elapsed": "Avg Latency (s)",
                          "total_cost": "Total Cost ($)",
                          "total_tokens": "Total Tokens",
                      }))
    step_summary["Avg Latency (s)"] = step_summary["Avg Latency (s)"].round(1)
    step_summary["Total Cost ($)"]  = step_summary["Total Cost ($)"].round(5)
    st.dataframe(step_summary, use_container_width=True, hide_index=True)

    st.divider()

    align_rows = df[df["step"] == "alignment"].copy()
    if not align_rows.empty and "avg_confidence" in align_rows.columns:
        st.subheader("Alignment Confidence over Runs")
        align_rows = align_rows.reset_index(drop=True)
        align_rows["run"] = align_rows.index + 1
        st.line_chart(align_rows.set_index("run")[["avg_confidence"]],
                      use_container_width=True)
        st.caption("Higher is better. Adjust threshold slider and re-align to improve.")

    note_rows = df[df["step"] == "note_gen"].copy()
    if not note_rows.empty and "template" in note_rows.columns:
        st.subheader("Note Generation — Cost by Template")
        tmpl_cost = (note_rows.groupby("template")["cost_usd"].sum()
                              .reset_index()
                              .rename(columns={"template":"Template","cost_usd":"Cost ($)"}))
        tmpl_cost["Cost ($)"] = tmpl_cost["Cost ($)"].round(5)
        st.dataframe(tmpl_cost, use_container_width=True, hide_index=True)

    st.divider()

    with st.expander("Raw run log"):
        st.dataframe(df, use_container_width=True)

    if st.button("🗑 Clear run log"):
        log_path.unlink(missing_ok=True)
        st.success("Run log cleared")
        st.rerun()
