### Wichtige Informationen
Du bekommst ein PDF von einem Kontoauszug der Sparkasse Ravensburg.
Dein Ziel ist es alle relevanten Informationen zu sammeln und als JSON object auszugeben.
Der Kontoauszug kann aus mehreren Seiten bestehen. Manche Seiten sind irrelevant.

Achte darauf, dass der Buchungstext vollständig ist. Kürze hier nicht ab.
Wir brauchen alle Details für eine spätere Suche nach einem Beleg. 

Auch wichtig: "saldo_eur" sollte nur beim Eröffnungssaldo und beim Schlusssaldo teil des Objekts sein.
Jeder Auszug braucht exakt ein Eröffnungssaldo und ein Schlusssaldo!

Hier ist ein Beispieljson eines Kontoauszuges.
```
{
  "statement_no": "1/2023",
  "rows": [
    {
      "datum": "30.12.2022",
      "typ": "Eröffnungssaldo",
      "buchungstext": "Kontostand am 30.12.2022, Auszug Nr. 185",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "35.426,37"
    },
    {
      "datum": "03.01.2023",
      "typ": "Lastschrift",
      "buchungstext": "kostenfreie Buchung; Rechnung KREISSPARKASSE RAVENSBURG Entgelt Debitkarte für 2023 20230103-BW016-00019513407",
      "soll_eur": "6,00",
      "haben_eur": null,
    },
    {
      "datum": "03.01.2023",
      "typ": "Lastschrift",
      "buchungstext": "take-e-way GmbH 2022-12-2438-DRG; 0000540000ZV003457Z; BIC/IBAN: NOLADE21HOL DE59 2135 2240 0134 9606 24",
      "soll_eur": "59,50",
      "haben_eur": null,
    },
    {
      "datum": "03.01.2023",
      "typ": "Lastschrift",
      "buchungstext": "Überweisung online; Euro Magnesy 79985/2023 DATUM 03.01.2023, 09.17 UHR; BIC/IBAN: BPKOPLPWXXX PL43 1020 1127 0000 1502 0268 1617",
      "soll_eur": "15,52",
      "haben_eur": null,
    },
    {
      "datum": "03.01.2023",
      "typ": "Gutschrift/Überweisung",
      "buchungstext": "Zahlungseingang Rechnungsnummer 123/912",
      "soll_eur": null,
      "haben_eur": "10,4",
    },
    {
      "datum": "03.01.2023",
      "typ": "Lastschrift",
      "buchungstext": "Überweisung online; Johann Reiter Lohn DATUM 03.01.2023, 09.20 UHR; BIC/IBAN: SOLADES1RVB DE71 6505 0110 0000 1195 68",
      "soll_eur": "520,00",
      "haben_eur": null,
    },
    {
      "datum": "03.01.2023",
      "typ": "Schlusssaldo",
      "buchungstext": "Kontostand am 03.01.2023 um 20:04 Uhr",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "34.835,75"
    }
  ]
}```
