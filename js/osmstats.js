$(function() {
  var OsmStats = OsmStats || {};

  OsmStats.api             = 'http://www.overpass-api.de/api/interpreter';
  OsmStats.maxNumberOfTags = 100;
  OsmStats.minFontSize     = 10;
  OsmStats.maxFontSize     = 72;
  OsmStats.gravity         = 0.1;
  OsmStats.linkDistance    = 600;
  OsmStats.charge          = -1;
  OsmStats.linkStrength    = 0.1;
  OsmStats.viz             = d3.select("body").append("svg:svg");
  OsmStats.stats           = {};
  OsmStats.force           = null;

  OsmStats.compute = function(username, numberOfTags) {
    $('#stats-button').attr('disabled', 'disabled');
    $('#test-button').attr('disabled', 'disabled');
    $('#stats-button').html('Fetching...');

    var params = window.encodeURIComponent(
      [
        "[out:json];",
        "(",
        "      node (user:'" + username + "');",
        "       way (user:'" + username + "');",
        "  relation (user:'" + username + "');",
        ");",
        "out;"
      ].join('')
    );

    var requestURL = OsmStats.api + '?data=' + params;

    if (username === 'zacmccormick-test')
      requestURL = 'zacmccormick.json';

    $.get(requestURL, function(data) {
      $('#stats-button').removeAttr('disabled');
      $('#test-button').removeAttr('disabled');
      $('#stats-button').html('Get Stats');

      var stats = { maxFrequency: OsmStats.minFontSize };

      data = typeof(data) == 'string' ? JSON.parse(data) : data;

      stats.totals = {
        nodes:     _.filter(data.elements, function(e) { return e.type == 'node'; }),
        ways:      _.filter(data.elements, function(e) { return e.type == 'way'; }),
        relations: _.filter(data.elements, function(e) { return e.type == 'relation'; })
      };

      stats.groups = _.chain(data.elements)
        .map(function(e) { if (e.tags) return _.map(e.tags, function(v, k) { return { key: k + '=' + v } }); })
        .flatten()
        .compact()
        .groupBy(function(tag) { if (tag.key) return tag.key; else return 'unknown'; })
        .map(function(value, key) { return [key, value]; })
        .reject(function(item) { return item[0].match(/^tiger|gnis/) })
        .sortBy(function(item) { return item[1].length; })
        .last(Math.min(Math.max(0, numberOfTags || 30), OsmStats.maxNumberOfTags))
        .value();

      stats.maxFrequency = _.reduce(stats.groups, function(m, v) {
        return Math.max(m, v[1].length);
      }, stats.maxFrequency);

      stats.nodes = _.map(stats.groups, function(g) {
        return { key: g[0], tags: g[1], links: [], relatedKeys: [] };
      });

      flat = {};

      _.each(stats.nodes, function(node, index) {
        node.index = index;
        flat[node.key] = node;
      });

      _.each(stats.nodes, function(node) {
         _.each(data.elements, function(e) {
           if (e.tags) {
             var tag = node.key.split('=')[0];
             var val = node.key.split('=')[1];

             if (e.tags[tag] && e.tags[tag] === val) {
               _.each(e.tags, function(v, k) {
                 var key = k + '=' + v;
                 if (k !== tag && flat[key] && !_.include(node.relatedKeys, key)) {
                   node.relatedKeys.push(key);
                   node.links.push(flat[key].index);
                 }
               });
             }
           }
         });
       });

       OsmStats.stats = stats;

       if (stats.groups.length === 0) {
         alert('That user either doesn\'t exist or has no edits on OpenStreetMap.');
       } else {
          $('.tools').show('slide', { direction: 'right' }, 500);
       }

       OsmStats.visualize(stats);
    });
  };

  OsmStats.visualize = function(stats) {
    var nodes = [];
    var links = [];

    $('#node-count').html(stats.totals.nodes.length);
    $('#way-count').html(stats.totals.ways.length);
    $('#relation-count').html(stats.totals.relations.length);

    $('.tags').empty();

    for (var i = 0; i < stats.groups.length; ++i) {
      var tag = stats.groups[stats.groups.length - i - 1][0];
      $('.tags').append('<label>' + tag + ' (' + stats.groups[stats.groups.length - i - 1][1].length + ')</label>');
    }

    _.each(stats.nodes, function(item) {
      nodes.push({ data: item, label : item.key });
    });

    for (var i = 0; i < stats.nodes.length; i++) {
      for(var j = 0; j < stats.nodes[i].links.length; j++) {
        links.push({
          source : stats.nodes[i].index,
          target : stats.nodes[i].links[j],
          weight : 0.1
        });
      }
    };

    var force = d3.layout.force()
                         .size([$('svg').width(), $('svg').height()])
                         .nodes(nodes)
                         .links(links)
                         .gravity(OsmStats.gravity)
                         .linkDistance(OsmStats.linkDistance)
                         .charge(OsmStats.charge)
                         .linkStrength(OsmStats.linkStrength);

    OsmStats.force = force;

    force.start();

    $('svg').remove();

    OsmStats.viz = d3.select("body").append("svg:svg");

    var viz = OsmStats.viz;

    var link = viz.selectAll("line.link")
                  .data(links)
                  .enter()
                  .append("svg:line")
                  .attr("class", function(node) {
                    return "link n" + node.source.index + " n" + node.target.index
                  });

    var node = viz.selectAll("g.node")
                  .data(force.nodes())
                  .enter()
                  .append("svg:g")
                  .attr("class", function(node) {
                    return "node " + node.index;
                  })
                  .on("mouseover", function(node) {
                    viz.selectAll("line.link.n" + node.index)
                        .attr("class", function(node) {
                          return "link n" + node.source.index + " n" + node.target.index + " highlight";
                        });
                  })
                  .on("mouseout", function(node) {
                    viz.selectAll("line.link.n" + node.index)
                       .attr("class", function(node) {
                         return "link n" + node.source.index + " n" + node.target.index;
                       });
                  });

    node.append("svg:circle").attr("r", 0);

    node.append("svg:text")
        .text(function(node, i) { return node.data.key })
        .style("font-size", function(node) {
          return ((node.data.tags.length / stats.maxFrequency) * (OsmStats.maxFontSize - OsmStats.minFontSize)) + OsmStats.minFontSize;
        });

    node.call(force.drag);

    var updateLink = function() {
      this.attr("x1", function(d) {
        return d.source.x;
      }).attr("y1", function(d) {
        return d.source.y;
      }).attr("x2", function(d) {
        return d.target.x;
      }).attr("y2", function(d) {
        return d.target.y;
      });
    }

    var updateNode = function() {
      this.attr("transform", function(d) {
        return "translate(" + d.x + "," + d.y + ")";
      });
    }

    force.on("tick", function() {
      node.call(updateNode);
      link.call(updateLink);
    });
  };

  $('#stats-button').click(function(target) {
    var username = $('#username').val();

    if (username.length === 0)
      alert('You must enter a username first.');
    else
      OsmStats.compute(username);
  });

  $('#test-button').click(function(target) {
    OsmStats.compute('zacmccormick-test');
  });

  $('.font-size').slider({
    value: 50,
    slide: function(event, ui) {
      OsmStats.viz.selectAll('text').style("font-size", function(node) {
          return ((ui.value + 50) / 100) * (((node.data.tags.length / OsmStats.stats.maxFrequency) * (OsmStats.maxFontSize - OsmStats.minFontSize)) + OsmStats.minFontSize);
      });
    }
  });

  $('.link-gravity').slider({
    value: 0,
    slide: function(event, ui) {
      var min = 0.0001, max = 4;
      var gravity =  min + ((max - min) * (ui.value / 100));
      OsmStats.force.gravity(gravity);
      OsmStats.force.start();
    }
  });

  $('.link-distance').slider({
    value: 50,
    slide: function(event, ui) {
      OsmStats.force.linkDistance(((ui.value + 50) / 100) * 600);
      OsmStats.force.start();
    }
  });

  $('.link-charge').slider({
    value: 50,
    slide: function(event, ui) {
      var min = -3000, max = 3000;
      var charge =  min + ((max - min) * (ui.value / 100));
      OsmStats.force.charge(charge);
      OsmStats.force.start();
    }
  });

  $('.link-strength').slider({
    value: 50,
    slide: function(event, ui) {
      OsmStats.force.linkStrength(function(node) {
        var min = 0.0000, max = 1;
        var strength =  min + ((max - min) * (ui.value / 100));
        return strength;
      });
      OsmStats.force.start();
    }
  });

  $('#github').click(function(target) {
    window.location = 'https://github.com/zhm/osmstats';
  });
});
