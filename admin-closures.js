function setupBookingClosures({ api, openDialog, dialogBusy, dateLabel, initialDate, notify, session }) {
  const $ = id => document.getElementById(id);
  const dialog = $("closure-dialog");
  const form = $("closure-form");
  const fields = $("closure-fields");
  const list = $("closure-list");
  const start = $("closure-start-date");
  const end = $("closure-end-date");
  let rows = [], editing = null, accepted = [], busy = false;

  function localStamp(ms) {
    return new Date(ms + 4 * 3600000).toISOString();
  }

  function describe(row) {
    const from = localStamp(row.start_ms);
    const to = localStamp(row.end_ms - (row.all_day ? 1 : 0));
    const startDay = dateLabel(from.slice(0, 10));
    const endDay = dateLabel(to.slice(0, 10));
    if (row.all_day) return startDay === endDay ? startDay + " / All day" : startDay + " to " + endDay + " / All day";
    return startDay + ", " + from.slice(11, 16) + " to " + (startDay === endDay ? "" : endDay + ", ") + to.slice(11, 16);
  }

  function showError(text) {
    $("closure-error").textContent = text;
    $("closure-error").hidden = !text;
  }

  function clearReview() {
    accepted = [];
    $("closure-conflicts").hidden = true;
    $("closure-conflict-list").replaceChildren();
    $("closure-save").textContent = editing ? "Save changes" : "Add closure";
  }

  function syncHours() {
    const allDay = $("closure-all-day").checked;
    $("closure-hours").hidden = allDay;
    for (const id of ["closure-start-time", "closure-end-time"]) {
      $(id).disabled = allDay;
      $(id).required = !allDay;
    }
    if (!end.value || end.value === end.min || end.value < start.value) end.value = start.value;
    end.min = start.value;
  }

  function edit(row = null) {
    editing = row;
    form.reset();
    const from = row ? localStamp(row.start_ms) : "";
    const to = row ? localStamp(row.end_ms - (row.all_day ? 1 : 0)) : "";
    start.value = row ? from.slice(0, 10) : initialDate();
    end.min = "";
    end.value = row ? to.slice(0, 10) : start.value;
    $("closure-all-day").checked = !row || !!row.all_day;
    if (row && !row.all_day) {
      $("closure-start-time").value = from.slice(11, 16);
      $("closure-end-time").value = to.slice(11, 16);
    }
    $("closure-reason").value = row?.reason || "";
    $("closure-form-title").textContent = row ? "Edit closure" : "New closure";
    $("closure-cancel-edit").hidden = !row;
    syncHours();
    clearReview();
    showError("");
  }

  function textElement(tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function listButton(label, icon, action) {
    const button = textElement("button", "", "icon-button quiet");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + icon + '"/></svg>';
    button.addEventListener("click", () => { if (!busy) action(); });
    return button;
  }

  function render() {
    list.replaceChildren();
    $("closure-empty").hidden = rows.length > 0;
    for (const row of rows) {
      const item = document.createElement("li");
      const info = document.createElement("div");
      info.append(textElement("strong", describe(row)));
      if (row.reason) info.append(textElement("p", row.reason, "small muted"));
      const actions = document.createElement("div");
      actions.className = "closure-row-actions";
      actions.append(
        listButton("Edit closure", "edit", () => { edit(row); start.focus(); }),
        listButton("Remove closure", "trash", () => {
          if (window.confirm("Remove this closure? Eligible times will reopen.")) void save({ action:"remove", id:row.id, version:row.version });
        })
      );
      item.append(info, actions);
      list.append(item);
    }
  }

  function setBusy(value, label = editing ? "Save changes" : "Add closure") {
    busy = value;
    fields.disabled = value;
    list.inert = value;
    dialogBusy("closure-dialog", value, "closure-save", label);
  }

  async function refresh(ticket) {
    const data = await api("booking-closures");
    if (ticket !== session() || !dialog.open) return;
    rows = data.closures;
    render();
  }

  async function save(body) {
    const ticket = session();
    showError("");
    setBusy(true);
    try {
      await api("booking-closures", body);
      if (ticket !== session() || !dialog.open) return;
      edit();
      notify(body.action === "remove" ? "Closure removed." : "Closure saved.");
      await refresh(ticket);
    } catch (error) {
      if (ticket !== session() || !dialog.open) return;
      if (error.data?.code === "closure_conflicts") {
        accepted = error.data.conflicts.map(row => row.id);
        $("closure-conflict-list").replaceChildren(...error.data.conflicts.map(row =>
          textElement("li", row.booking_date + " / " + row.booking_time + " / " +
            row.first_name + " " + row.last_name + " (" + (row.status === "pending_payment" ? "Payment in progress" :
              row.status === "payment_review" ? "Needs payment review" : row.status) + ")")
        ));
        $("closure-conflicts").hidden = false;
        $("closure-conflicts").focus();
      } else showError(error.message);
    } finally {
      setBusy(false, accepted.length ? "Save closure anyway" : undefined);
    }
  }

  $("manage-closures").addEventListener("click", async () => {
    if (busy) return;
    const ticket = session();
    rows = [];
    edit();
    render();
    $("closure-empty").hidden = true;
    openDialog("closure-dialog");
    setBusy(true, "Loading...");
    try { await refresh(ticket); }
    catch (error) { if (ticket === session() && dialog.open) showError(error.message); }
    finally { setBusy(false); if (dialog.open) start.focus(); }
  });
  $("closure-cancel-edit").addEventListener("click", () => { edit(); start.focus(); });
  form.addEventListener("input", () => { syncHours(); clearReview(); showError(""); });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const body = Object.fromEntries(new FormData(form));
    void save({
      ...body, action:"save", all_day:$("closure-all-day").checked, accepted_conflicts:accepted,
      ...(editing ? { id:editing.id, version:editing.version } : {}),
    });
  });
  dialog.addEventListener("close", () => { rows = []; edit(); render(); });
}
