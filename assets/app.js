const apiURL = "https://unpkg.com/safa-json@1.0.0/data";

function faskesApp() {
    return {
        map: null,
        groups: {},
        fullData: [],
        filteredFaskes: [],
        countFaskes: 0,
        countJnsFaskes: 0,
        rincianFaskes: {},

        allKecamatan: [],
        kecamatanList: [],
        kabupatenList: [],
        selectedKabupaten: '',
        selectedKecamatan: '',
        kabupatenGeo: 0,
        kecamatanGeo: 0,
        searchTerm: "",


        categoriesChart: [],
        dataSetChart: [],
        chartData: [],

        layerControl: null,


        async init() {

            console.log("[App] Initialized!");
            document.getElementById("loading").classList.remove("hidden");
            this.map = L.map("map").setView([-7.5, 108], 8);

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors",
            }).addTo(this.map);

            const res = await fetch(`${apiURL}/data.json`);
            this.fullData = await res.json();
            this.filteredFaskes = this.fullData;

            this.countFaskes = this.filteredFaskes.length;
            this.countJnsFaskes = new Set(this.fullData.map(f => f.nmjnsppk)).size;

            this.rincianFaskes = this.filteredFaskes.reduce((acc, f) => {
                acc[f.nmjnsppk] = (acc[f.nmjnsppk] || 0) + 1;
                return acc;
            }, {});

            const geojsonRes = await fetch(`${apiURL}/jabar_by_kab.geojson`);

            await Promise.all([geojsonRes, this.loadKabupaten(), this.loadKecamatan()])
            const geojsonKabupaten = await geojsonRes.json();


            // Fetch Data Chart
            async function matchFaskesToKabupaten(faskesList, geojson) {
                const kabCounts = {}; // { 'Kabupaten A': { 'RS': 10, 'Puskesmas': 5, ... }, ... }

                faskesList.forEach(f => {
                    if (!f.latitude || !f.longitude) return;

                    const point = turf.point([f.longitude, f.latitude]);

                    geojson.features.forEach(feature => {
                        if (turf.booleanPointInPolygon(point, feature)) {
                            const kabName = feature.properties.KABKOT;
                            const jenis = f.nmjnsppk || 'Lainnya';

                            if (!kabCounts[kabName]) kabCounts[kabName] = {};
                            if (!kabCounts[kabName][jenis]) kabCounts[kabName][jenis] = 0;

                            kabCounts[kabName][jenis]++;
                        }
                    });
                });

                return kabCounts;
            }

            this.chartData = await matchFaskesToKabupaten(this.filteredFaskes, geojsonKabupaten);

            // categories adalah list kabupaten untuk x-axis
            this.categoriesChart = Object.keys(this.chartData);

            const jenisSet = new Set();
            Object.values(this.chartData).forEach(jenisObj => {
                Object.keys(jenisObj).forEach(j => jenisSet.add(j));
            });
            const jenisArray = Array.from(jenisSet);

            this.dataSetChart = jenisArray.map(jenis => ({
                name: jenis,
                data: this.categoriesChart.map(kab => {
                    const jenisObj = this.chartData[kab];
                    if (jenisObj && typeof jenisObj === 'object') {
                        const val = jenisObj[jenis];
                        return typeof val === 'number' && !isNaN(val) ? val : 0;
                    }
                    return 0;
                }),
            }));
            this.bindEvents();

            const chart = new ApexCharts(document.querySelector("#sebaranDataFaskes"), this.getChartOptions());
            chart.render().then(() => {
                document.getElementById("chartLoader").classList.add("hidden");
                document.getElementById("chartContainer").classList.remove("hidden");
            });
            this.renderGroupedMarkers();
            this.initLayerControl();

            document.getElementById("formLoader")?.classList.add("hidden");
            setTimeout(() => {

                document.getElementById("loading").classList.add("hidden");
            }, 500)

        },
        getChartOptions() {
            console.log(this.chartData)
            return {
                chart: {
                    type: 'bar',
                    stacked: true,
                    height: 400,

                },
                plotOptions: {
                    bar: {
                        horizontal: false,
                        dataLabels: {
                            position: 'top', // top, center, bottom
                        },
                    },
                },
                xaxis: {
                    categories: this.categoriesChart,
                },
                plotOptions: {
                    bar: {
                        horizontal: false,
                        borderRadius: 10,
                        borderRadiusApplication: 'end', // 'around', 'end'
                        borderRadiusWhenStacked: 'last', // 'all', 'last'
                        dataLabels: {
                            total: {
                                enabled: true,
                                style: {
                                    fontSize: '13px',
                                    fontWeight: 900
                                }
                            }
                        }
                    },
                },
                dataLabels: {
                    enabled: false,
                    offsetY: -20,
                    style: {
                        fontSize: '12px',
                        colors: ["#304758"]
                    }
                },
                legend: {
                    position: 'top',
                },
                fill: {
                    opacity: 1,
                },
                series: this.dataSetChart,

            };
        },



        filteringFaskes() {
            console.log(this.selectedKecamatan)
            document.getElementById("loading").classList.remove("hidden");
            setTimeout(() => {
                let poly = null;

                if (this.selectedKecamatan && this.kecamatanGeo) {
                    const kecFeature = this.kecamatanGeo.find(
                        f => String(f.properties.ID_KEC) === String(this.selectedKecamatan)
                    );
                    if (kecFeature) {
                        poly = kecFeature; // gunakan full feature, bukan geometry
                    }
                } else if (this.selectedKabupaten && this.kabupatenGeo) {
                    const kabFeature = this.kabupatenGeo.find(
                        f => String(f.properties.ID_KAB) === String(this.selectedKabupaten)
                    );
                    if (kabFeature) {
                        poly = kabFeature; // gunakan full feature
                    }
                }

                if (poly && this.map) {
                    this.focusPolygon(poly); // kirim full feature
                }

                const bbox = poly ? turf.bbox(poly) : null;

                this.filteredFaskes = this.fullData.filter(faskes => {
                    const matchSearch = !this.searchTerm || (
                        faskes.nmppk?.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                        faskes.nmjlnppk?.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
                        faskes.nmjnsppk?.toLowerCase().includes(this.searchTerm.toLowerCase())
                    );

                    let matchBound = true;
                    if (poly) {
                        // Fast reject outside bounding box before running turf
                        if (
                            faskes.longitude < bbox[0] || faskes.longitude > bbox[2] ||
                            faskes.latitude < bbox[1] || faskes.latitude > bbox[3]
                        ) {
                            matchBound = false;
                        } else {
                            matchBound = turf.booleanPointInPolygon(
                                turf.point([faskes.longitude, faskes.latitude]),
                                poly.geometry
                            );
                        }
                    }

                    return matchBound && matchSearch;
                });

                this.renderGroupedMarkers();
                document.getElementById("loading").classList.add("hidden");
            }, 100);
        },


        async matchFaskesToKabupaten(faskesList, geojson) {
            const kabCounts = {};

            faskesList.forEach(f => {
                if (!f.latitude || !f.longitude) return;

                const point = turf.point([f.longitude, f.latitude]);

                geojson.features.forEach(feature => {
                    if (turf.booleanPointInPolygon(point, feature)) {
                        const kabName = feature.properties.KABKOT;
                        kabCounts[kabName] = (kabCounts[kabName] || 0) + 1;
                    }
                });
            });

            return kabCounts;
        },

        bindEvents() {
            const searchInput = document.getElementById("search");
            const searchBtn = document.querySelector("button[type=submit]");

            const debouncedSearch = this.debounce(() => this.filteringFaskes(), 300);
            searchInput.addEventListener("input", (e) => {
                this.searchTerm = e.target.value;
                debouncedSearch();
            });

            searchBtn.addEventListener("click", (e) => {
                e.preventDefault();

                // Reset inputs
                this.searchTerm = "";
                searchInput.value = "";
                this.selectedKabupaten = "";
                this.selectedKecamatan = "";

                // Optionally clear suggestions if you have that reactive state
                if (this.suggestions) this.suggestions = [];

                // Call filtering after reset
                this.filteringFaskes();
            });

            searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.filteringFaskes();
                }
            });
        },

        debounce(fn, delay) {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => fn.apply(this, args), delay);
            };
        },

        renderGroupedMarkers() {
            if (this.markerClusterGroup) {
                this.map.removeLayer(this.markerClusterGroup);
            }

            this.markerClusterGroup = L.markerClusterGroup();
            this.groups = {};

            this.filteredFaskes.forEach(f => {
                if (!f.latitude || !f.longitude) return;

                const key = f.nmjnsppk || "Lainnya";

                const marker = L.marker([f.latitude, f.longitude]);
                marker.bindPopup(`
            <strong>${f.nmppk}</strong><br>
            ${f.nmjlnppk}<br>
            Jenis: ${f.nmjnsppk}<br>
            Telp: ${f.telpppk}
        `);
                marker.faskesId = f.kdppk;

                marker.on("click", () => this.focusMarker(f));

                this.markerClusterGroup.addLayer(marker);

                if (!this.groups[key]) {
                    this.groups[key] = L.layerGroup();  // Fix: gunakan LayerGroup
                }
                this.groups[key].addLayer(marker); // Tambahkan marker ke LayerGroup
            });

            this.map.addLayer(this.markerClusterGroup);

            if (this.filteredFaskes.length > 0) {
                const bounds = this.markerClusterGroup.getBounds();
                if (bounds.isValid()) this.map.fitBounds(bounds.pad(0.1));
            }
        },



        initLayerControl() {
            if (this.layerControl) {
                this.map.removeControl(this.layerControl);
            }
            this.layerControl = L.control.layers(null, this.groups, { collapsed: false }).addTo(this.map);
        },

        focusMarker(faskes) {
            this.selectedFaskes = faskes;
            let targetMarker = null;

            for (const key in this.groups) {
                this.groups[key].eachLayer(m => {
                    if (m.faskesId === faskes.kdppk) targetMarker = m;
                });
            }

            if (targetMarker) {
                this.map.flyTo([faskes.latitude, faskes.longitude], this.map.getZoom(), {
                    animate: true,
                    duration: 1.5,
                });

                setTimeout(() => {
                    targetMarker.openPopup();
                    targetMarker._icon?.classList.add("bounce-marker");
                }, 1600);
            }
        },
        focusPolygon(feature) {
            if (!feature || !this.map) return;

            const layer = L.geoJSON(feature); // gunakan full feature
            const bounds = layer.getBounds();

            if (bounds.isValid()) {
                this.map.fitBounds(bounds, { maxZoom: 10 });
                console.log(bounds);
            } else {
                console.warn("Invalid bounds for polygon focus", feature);
            }
        },
        async loadKabupaten() {
            try {
                const res = await fetch(`${apiURL}/jabar_by_kab.geojson`,
                    {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                );
                const data = await res.json();
                this.kabupatenList = data.features.map(f => ({
                    kab: f.properties.KABKOT,
                    id: f.properties.ID_KAB
                }));
                this.kabupatenGeo = data.features;
            } catch (error) {
                console.error("Failed to load kabupaten:", error);
            }
        },

        async loadKecamatan() {
            try {
                const res = await fetch(`${apiURL}/jabar_by_kec.geojson`);
                const data = await res.json();
                this.allKecamatan = data.features.map(f => ({
                    kec: f.properties.KECAMATAN,
                    kab: f.properties.ID_KAB,
                    id: f.properties.ID_KEC
                }));
                this.kecamatanGeo = data.features;
            } catch (error) {
                console.error("Failed to load kecamatan:", error);
            }
        },

        filterKecamatanByKabupaten() {
            if (!this.selectedKabupaten) {
                this.kecamatanList = [];
                return;
            }

            console.log(this.allKecamatan)
            console.log("Kec:", this.selectedKecamatan)
            console.log("Kab:", this.selectedKabupaten)
            console.log(this.kecamatanList)

            this.kecamatanList = this.allKecamatan.filter(kec => String(kec.kab) === String(this.selectedKabupaten));
        },

        onKabupatenChange() {
            this.selectedKecamatan = null;
            this.filterKecamatanByKabupaten();
            console.log(this.selectedKabupaten)
            this.filteringFaskes();
        },
        searchFaskes() {
            return {
                query: '',
                suggestions: [],
                showSuggestions: false,
                onSearch() {
                    if (this.query.trim() === '') {
                        this.suggestions = [];
                        return
                    }
                    this.suggestions = this.filteredFaskes.filter(f =>
                        f.nmppk.toLowerCase().includes(this.query.toLowerCase())
                    );
                    console.log(this.suggestions)
                },
                selectSuggestion(item) {
                    this.query = item.nmppk;
                    this.showSuggestions = false;
                }
            }
        },

    };
}