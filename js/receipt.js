/* 80mm thermal receipt, printing and WhatsApp receipt message. */
const Receipt = (() => {
  function promoBlock(bill) {
    return (bill.promotions || []).map(promo => {
      const freeNames = (promo.freeItems || []).map(item => `${esc(item.name)}${[item.size, item.color].filter(Boolean).length ? ` (${esc([item.size, item.color].filter(Boolean).join("/"))})` : ""}${item.qty > 1 ? ` x${item.qty}` : ""}`).join(", ");
      return `<div class="r-promo">
        <strong>${esc(BPPromotions.promoLabel(promo))}</strong>
        ${promo.name ? `<div>${esc(promo.name)}</div>` : ""}
        <div>Free Product: ${freeNames}</div>
        <div><b>Promotion Saving: ${money(promo.saving)}</b></div>
      </div>`;
    }).join("");
  }

  function html(bill, copyLabel = "Customer Copy") {
    const settings = state.settings;
    const totals = billTotals(bill);
    const payments = billPayments(bill);
    const paid = bill.v === 2 ? sum(payments, payment => payment.tendered ?? payment.amount) : Number(bill.received || 0);
    const due = billDue(bill);
    const change = bill.v === 2 ? Number(bill.change || 0) : Math.max(0, Number(bill.received || 0) - totals.total);
    const returns = billReturns(bill);
    const footerAlign = ["left", "center", "right"].includes(settings.receiptFooterAlign) ? settings.receiptFooterAlign : "center";
    const footerText = esc(settings.receiptFooter || "").replace(/\n/g, "<br>");
    const items = (bill.items || []).map(item => {
      const variant = [item.size, item.color].filter(Boolean).join(" / ");
      const free = Number(item.freeQty || 0);
      const lineTotal = bill.v === 2
        ? Number(item.price) * Number(item.qty)
        : Number(item.price) * Number(item.qty) * (1 - Number(item.discount || 0) / 100);
      return `<div class="r-item">
        <div class="r-item-top"><span>${esc(item.name)}</span><span>${money(lineTotal)}</span></div>
        <div class="r-item-sub"><span>${esc([item.sku ? `SKU ${item.sku}` : "", variant].filter(Boolean).join(" · "))}</span><span>${item.qty} x ${money(item.price)}</span></div>
        ${free ? `<div class="r-free">FREE ITEM x${free}: -${money(free * Number(item.price))}</div>` : ""}
        ${bill.v !== 2 && Number(item.discount || 0) ? `<div class="r-item-sub"><span>Discount ${item.discount}%</span></div>` : ""}
      </div>`;
    }).join("");
    const returnsHtml = returns.length ? `<div class="r-line"></div><div class="r-tot">
        ${returns.map(record => `<div><span>${record.type === "exchange" ? "Exchange" : "Return"} ${fmtDate(record.date)}</span><span>${record.netChange < 0 ? "-" : "+"}${money(Math.abs(record.netChange))}</span></div>`).join("")}
        <div><b>Net After Returns</b><b>${money(billNetTotal(bill))}</b></div>
      </div>` : "";
    return `<div class="receipt-page"><div class="receipt">
      ${settings.logo ? `<img class="r-logo" src="${settings.logo}" alt="">` : ""}
      <h1>${esc((settings.shopName || "Brands Planets").toUpperCase())}</h1>
      <div class="r-sub">${esc(bill.outlet || currentOutlet().name || "")}</div>
      <div class="r-sub">${[settings.phone, esc(settings.address || "").replace(/\n/g, "<br>"), esc(settings.email || "")].filter(Boolean).join("<br>")}</div>
      <div class="r-center"><span class="r-copy">${esc(copyLabel.toUpperCase())}</span></div>
      ${isCancelled(bill) ? `<div class="r-center" style="font-weight:900;margin-top:2mm">*** CANCELLED ***</div>` : ""}
      <div class="r-line"></div>
      <div class="r-meta">
        <div><span>Invoice No.</span><b>${esc(bill.id)}</b></div>
        <div><span>Date</span><span>${fmtDate(bill.date)}</span></div>
        <div><span>Time</span><span>${fmtTime(bill.date)}</span></div>
        <div><span>Cashier</span><span>${esc(bill.cashier || "")}</span></div>
        <div><span>Customer</span><span>${esc(bill.customerName || "Walk-in Customer")}</span></div>
        ${bill.customerPhone ? `<div><span>Phone</span><span>${esc(bill.customerPhone)}</span></div>` : ""}
        ${bill.saleMode && bill.saleMode !== "In Store" ? `<div><span>Channel</span><span>${esc(bill.saleMode)}</span></div>` : ""}
      </div>
      <div class="r-line"></div>
      ${items}
      <div class="r-line"></div>
      <div class="r-tot">
        <div><span>Items</span><span>${billItemCount(bill)}</span></div>
        <div><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
        ${totals.promoDiscount ? `<div><span>Promotional Discount</span><span>-${money(totals.promoDiscount)}</span></div>` : ""}
        ${totals.itemDiscount + totals.billLevelDiscount ? `<div><span>Discount</span><span>-${money(totals.itemDiscount + totals.billLevelDiscount)}</span></div>` : ""}
      </div>
      <div class="r-tot r-grand"><div><span>FINAL TOTAL</span><span>${money(totals.total)}</span></div></div>
      ${promoBlock(bill)}
      <div class="r-tot">
        ${payments.map(payment => `<div><span>${esc(payment.method)}${payment.ref ? ` (${esc(payment.ref)})` : ""}</span><span>${money(payment.tendered ?? payment.amount)}</span></div>`).join("")}
        <div><span>Paid Amount</span><span>${money(paid)}</span></div>
        <div><b>${due > 0 ? "Balance Due" : "Balance / Change"}</b><b>${money(due > 0 ? due : change)}</b></div>
      </div>
      ${returnsHtml}
      <div class="r-line"></div>
      <div class="r-thanks">Thank you for shopping with Brands Planets.</div>
      ${settings.receiptFooterEnabled !== false && footerText ? `${settings.receiptFooterDivider === false ? "" : `<div class="r-line"></div>`}<div class="r-foot" style="text-align:${footerAlign}">${footerText}</div>` : ""}
      <div class="r-barcode">${esc(bill.id)}</div>
    </div></div>`;
  }

  function printMarkup(markup, onDone) {
    const area = document.getElementById("printArea");
    area.innerHTML = markup;
    document.body.classList.add("receipt-printing");
    const images = [...area.querySelectorAll("img")].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; }));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("afterprint", finish);
      document.body.classList.remove("receipt-printing");
      area.innerHTML = "";
      if (onDone) setTimeout(onDone, 150);
    };
    window.addEventListener("afterprint", finish);
    Promise.all(images).then(() => requestAnimationFrame(() => setTimeout(() => {
      window.print();
      setTimeout(finish, 60000);
    }, 120)));
  }

  function print(bill, copyLabel = "Customer Copy", onDone) {
    printMarkup(html(bill, copyLabel), () => {
      toast("Receipt Printed ✓");
      onDone?.();
    });
  }

  function whatsappPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (/^03\d{9}$/.test(digits)) return `92${digits.slice(1)}`;
    if (/^923\d{9}$/.test(digits)) return digits;
    return "";
  }
  function whatsappMessage(bill) {
    const outlet = state.settings.shopName || "Brands Planets";
    const promo = (bill.promotions || []).length
      ? `\n🎁 ${bill.promotions.map(p => BPPromotions.promoLabel(p)).join(", ")} — you saved ${money(billTotals(bill).promoDiscount)}!`
      : "";
    return `🛍️ *Thank You for Shopping With Us!*\nHi ${bill.customerName || "there"} 👋\nYour purchase at our outlet has been completed successfully. ✅\n\n🧾 Receipt No: ${bill.id}\n💰 Total Paid: ${money(billTotals(bill).total)}${promo}\n📍 Outlet: ${outlet}\n\nThank you for visiting us. We hope to see you again soon! ❤️`;
  }
  function sendWhatsApp(bill) {
    const phone = whatsappPhone(bill.customerPhone);
    if (!phone) return toast("Customer WhatsApp number is missing or invalid.", "error");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage(bill))}`, "_blank", "noopener,noreferrer");
  }

  return { html, print, printMarkup, whatsappPhone, whatsappMessage, sendWhatsApp };
})();
