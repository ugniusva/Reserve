(() => {
  const url = new URL(window.location.href);
  const requestedLanguage = url.searchParams.get("lang");
  const language = requestedLanguage === "ka" || requestedLanguage === "en"
    ? requestedLanguage
    : document.documentElement.lang === "ka" ? "ka" : "en";
  const result = document.body.dataset.result;
  const common = {
    en: {
      skip: "Skip to payment result", language: "Language", navigation: "Main navigation",
      homeLabel: "Reserve, homepage", reservations: "Reservations", menu: "Menu",
      referenceLabel: "Reservation reference", copyReference: "Copy reference",
      copied: "Reference copied.", copyFailed: "Unable to copy. You can select and copy the reference above.",
      address: "3 9 Aprili Street, Tbilisi"
    },
    ka: {
      skip: "გადახდის შედეგზე გადასვლა", language: "ენა", navigation: "მთავარი ნავიგაცია",
      homeLabel: "Reserve, მთავარი გვერდი", reservations: "დაჯავშნა", menu: "მენიუ",
      referenceLabel: "ჯავშნის ნომერი", copyReference: "ნომრის კოპირება",
      copied: "ნომერი დაკოპირებულია.", copyFailed: "კოპირება ვერ მოხერხდა. შეგიძლიათ ზემოთ მოცემული ნომერი მონიშნოთ და დააკოპიროთ.",
      address: "9 აპრილის ქუჩა 3, თბილისი"
    }
  };
  const messages = {
    success: {
      en: {
        status: "Deposit payment complete", heading: "Payment successful",
        intro: "Thank you for choosing Reserve. Your deposit payment is complete, and our team will now process your reservation.",
        nextTitle: "Your confirmation", nextText: "Look out for your reservation confirmation at the email address you provided.",
        depositTitle: "Your deposit", depositText: "Your deposit will be applied towards your final bill. We look forward to welcoming you.",
        primary: "Back to Reserve", secondary: "Make another reservation", contact: "No confirmation email? Please contact us at"
      },
      ka: {
        status: "დეპოზიტი გადახდილია", heading: "გადახდა წარმატებულია",
        intro: "გმადლობთ, რომ აირჩიეთ Reserve. დეპოზიტის გადახდა დასრულებულია. ჩვენი გუნდი ახლა თქვენს ჯავშანს დაამუშავებს.",
        nextTitle: "ჯავშნის დადასტურება", nextText: "ჯავშნის დადასტურებას თქვენ მიერ მითითებულ ელფოსტაზე მიიღებთ.",
        depositTitle: "თქვენი დეპოზიტი", depositText: "დეპოზიტი საბოლოო ანგარიშში ჩაითვლება. მოხარული ვიქნებით, გიმასპინძლოთ.",
        primary: "Reserve-ზე დაბრუნება", secondary: "კიდევ ერთი მაგიდის დაჯავშნა", contact: "დადასტურება ვერ მიიღეთ? დაგვიკავშირდით ნომერზე"
      }
    },
    failed: {
      en: {
        status: "Deposit payment incomplete", heading: "Payment not completed",
        intro: "Your payment was cancelled or could not be completed. Your reservation has not been confirmed through this payment.",
        nextTitle: "You can try again", nextText: "Return to reservations to choose your date and time again. Availability may have changed.",
        depositTitle: "Already charged?", depositText: "Please contact us before making another payment, so we can check your reservation with you.",
        primary: "Try your reservation again", secondary: "Back to Reserve", contact: "Need a hand? Call us at"
      },
      ka: {
        status: "გადახდა შეწყდა", heading: "გადახდა არ დასრულდა",
        intro: "გადახდა გაუქმდა ან ვერ დასრულდა. ამ გადახდით თქვენი ჯავშანი არ დადასტურებულა.",
        nextTitle: "შეგიძლიათ სცადოთ ხელახლა", nextText: "დაბრუნდით დაჯავშნის გვერდზე და ხელახლა აირჩიეთ თარიღი და დრო. ხელმისაწვდომობა შესაძლოა შეცვლილი იყოს.",
        depositTitle: "თანხა ჩამოგეჭრათ?", depositText: "ხელახლა გადახდამდე გთხოვთ, დაგვიკავშირდეთ, რათა თქვენი ჯავშანი ერთად გადავამოწმოთ.",
        primary: "ხელახლა დაჯავშნა", secondary: "Reserve-ზე დაბრუნება", contact: "გჭირდებათ დახმარება? დაგვირეკეთ ნომერზე"
      }
    }
  };
  const copy = { ...common[language], ...messages[result][language] };
  document.documentElement.lang = language;
  document.querySelectorAll("[data-copy]").forEach(element => {
    element.textContent = copy[element.dataset.copy];
  });
  document.querySelectorAll("[data-label]").forEach(element => {
    element.setAttribute("aria-label", copy[element.dataset.label]);
    if (element.hasAttribute("title")) element.title = copy[element.dataset.label];
  });
  document.querySelectorAll("[data-home]").forEach(link => {
    link.href = language === "ka" ? "ge.html#top" : "index.html#top";
  });
  document.querySelectorAll("[data-booking]").forEach(link => {
    link.href = language === "ka" ? "Rge.html" : "reservation.html";
  });
  document.getElementById("menu-link").href = language === "ka" ? "menuge.pdf" : "menu.pdf";
  ["en", "ka"].forEach(lang => {
    const link = document.getElementById(`language-${lang}`);
    const target = new URL(`reservation-${result}${lang === "ka" ? "ge" : ""}.html`, url);
    target.search = url.search;
    target.searchParams.delete("lang");
    link.href = target.href;
    link.setAttribute("aria-label", lang === "ka" ? "ქართული" : "English");
    if (lang === language) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  // The bank return is presentation only. This page never confirms or updates a booking.
  const reservationId = url.searchParams.get("reservationId") || "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservationId)) {
    document.getElementById("reservation-reference").textContent = reservationId;
    document.getElementById("reference-row").hidden = false;
    const button = document.getElementById("copy-reference");
    if (navigator.clipboard?.writeText) {
      button.hidden = false;
      button.addEventListener("click", async () => {
        const feedback = document.getElementById("copy-feedback");
        try {
          await navigator.clipboard.writeText(reservationId);
          feedback.textContent = copy.copied;
        } catch {
          feedback.textContent = copy.copyFailed;
        }
        feedback.hidden = false;
      });
    }
  }
})();
